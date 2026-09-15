import type { Prisma, PrismaClient } from "@prisma/client";

import { VAULT_STATUS, type VaultStatus } from "../generated/chronoflow.js";
import { asBigInt, asNumber, asString } from "../lib/values.js";
import type { DecodedEvent } from "./decode.js";

type Tx = Prisma.TransactionClient;

/** Mirrors `milestone_unlock_time` in the contract. */
export function milestoneUnlockTime(
  startTime: bigint,
  duration: bigint,
  milestones: number,
  index: number,
): bigint {
  return startTime + (duration * BigInt(index + 1)) / BigInt(milestones);
}

/**
 * Folds one decoded event into the database.
 *
 * The whole event is applied inside a transaction and guarded by the unique
 * `VaultEvent.eventId`, so replays (re-orgs, restarts, overlapping polls) are
 * idempotent.
 *
 * @returns true when the event was newly applied, false when it was a replay.
 */
export async function applyDecodedEvent(
  prisma: PrismaClient,
  event: DecodedEvent,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const alreadyIngested = await tx.vaultEvent.findUnique({
      where: { eventId: event.eventId },
      select: { id: true },
    });
    if (alreadyIngested) return false;

    switch (event.topic) {
      case "vault_created":
        await applyVaultCreated(tx, event);
        break;
      case "milestone_released":
        await applyMilestoneReleased(tx, event);
        break;
      case "vault_completed":
        await applyVaultCompleted(tx, event);
        break;
      case "vault_clawed_back":
        await applyVaultClawedBack(tx, event);
        break;
      default:
        // Admin events (clawback delay, pause) carry no vault state; they are
        // still logged below for observability.
        break;
    }

    await tx.vaultEvent.create({
      data: {
        eventId: event.eventId,
        vaultId: vaultIdOf(event),
        topic: event.topic,
        kind: event.specName,
        ledger: event.ledger,
        txHash: event.txHash,
        contractId: event.contractId,
        payload: JSON.stringify(event.payload, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
        occurredAt: BigInt(event.occurredAt),
      },
    });

    return true;
  });
}

function vaultIdOf(event: DecodedEvent): number | null {
  const value = event.payload.vault_id;
  if (value === undefined) return null;
  try {
    return asNumber(value, "vault_id");
  } catch {
    return null;
  }
}

async function applyVaultCreated(tx: Tx, event: DecodedEvent): Promise<void> {
  const { payload } = event;

  const id = asNumber(payload.vault_id, "vault_id");
  const funder = asString(payload.funder, "funder");
  const recipient = asString(payload.recipient, "recipient");
  const token = asString(payload.token, "token");
  const totalAmount = asBigInt(payload.total_amount, "total_amount");
  const amountPerMilestone = asBigInt(payload.amount_per_milestone, "amount_per_milestone");
  const milestones = asNumber(payload.milestones, "milestones");
  const startTime = asBigInt(payload.start_time, "start_time");
  const duration = asBigInt(payload.duration, "duration");
  const clawbackTime = asBigInt(payload.clawback_time, "clawback_time");

  const state = {
    funder,
    recipient,
    token,
    totalAmount: totalAmount.toString(),
    amountPerMilestone: amountPerMilestone.toString(),
    duration: Number(duration),
    milestones,
    startTime,
    clawbackTime,
    createdLedger: event.ledger,
    createdTxHash: event.txHash,
  };

  await tx.vault.upsert({
    where: { id },
    create: {
      id,
      ...state,
      amountReleased: "0",
      milestonesReleased: 0,
      status: VAULT_STATUS.Active,
    },
    // A replay after a re-org refreshes the immutable fields.
    update: state,
  });

  for (let index = 0; index < milestones; index += 1) {
    const unlockTime = milestoneUnlockTime(startTime, duration, milestones, index);
    await tx.milestone.upsert({
      where: { vaultId_index: { vaultId: id, index } },
      create: {
        vaultId: id,
        index,
        amount: amountPerMilestone.toString(),
        unlockTime,
      },
      update: { amount: amountPerMilestone.toString(), unlockTime },
    });
  }
}

async function applyMilestoneReleased(tx: Tx, event: DecodedEvent): Promise<void> {
  const { payload } = event;

  const vaultId = asNumber(payload.vault_id, "vault_id");
  const index = asNumber(payload.milestone_index, "milestone_index");
  const amount = asBigInt(payload.amount, "amount");
  const releasedAt = asBigInt(payload.released_at, "released_at");

  const vault = await tx.vault.findUnique({ where: { id: vaultId } });
  if (!vault) {
    // The creation event is older than the RPC retention window; nothing to
    // fold the release into. The raw event is still recorded.
    return;
  }

  await tx.milestone.upsert({
    where: { vaultId_index: { vaultId, index } },
    create: {
      vaultId,
      index,
      amount: amount.toString(),
      unlockTime: milestoneUnlockTime(
        vault.startTime,
        BigInt(vault.duration),
        vault.milestones,
        index,
      ),
      released: true,
      releasedAt,
      releaseTxHash: event.txHash,
      releaseLedger: event.ledger,
    },
    update: {
      released: true,
      releasedAt,
      releaseTxHash: event.txHash,
      releaseLedger: event.ledger,
    },
  });

  const milestonesReleased = Math.max(vault.milestonesReleased, index + 1);
  const amountReleased = (BigInt(vault.amountReleased) + amount).toString();
  const status: VaultStatus =
    milestonesReleased >= vault.milestones ? VAULT_STATUS.Completed : VAULT_STATUS.Active;

  await tx.vault.update({
    where: { id: vaultId },
    data: { milestonesReleased, amountReleased, status },
  });
}

async function applyVaultCompleted(tx: Tx, event: DecodedEvent): Promise<void> {
  const vaultId = asNumber(event.payload.vault_id, "vault_id");
  const totalReleased = asBigInt(event.payload.total_released, "total_released");

  const vault = await tx.vault.findUnique({ where: { id: vaultId }, select: { id: true } });
  if (!vault) return;

  await tx.vault.update({
    where: { id: vaultId },
    data: { status: VAULT_STATUS.Completed, amountReleased: totalReleased.toString() },
  });
}

async function applyVaultClawedBack(tx: Tx, event: DecodedEvent): Promise<void> {
  const vaultId = asNumber(event.payload.vault_id, "vault_id");

  const vault = await tx.vault.findUnique({ where: { id: vaultId }, select: { id: true } });
  if (!vault) return;

  await tx.vault.update({
    where: { id: vaultId },
    data: { status: VAULT_STATUS.ClawedBack },
  });
}
