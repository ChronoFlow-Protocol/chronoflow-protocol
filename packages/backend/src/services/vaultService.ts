import type { Milestone, PrismaClient, Vault, VaultEvent } from "@prisma/client";

import { VAULT_STATUS, type VaultStatus } from "../generated/chronoflow.js";
import { formatUnits } from "../lib/values.js";

export type MilestoneState = "released" | "releasable" | "locked" | "cancelled";

export interface MilestoneView {
  index: number;
  amount: string;
  amountDisplay: string;
  unlockTime: number;
  released: boolean;
  releasedAt: number | null;
  releaseTxHash: string | null;
  releasable: boolean;
  state: MilestoneState;
}

export interface VaultEventView {
  eventId: string;
  kind: string;
  topic: string;
  ledger: number;
  txHash: string;
  occurredAt: number;
  payload: unknown;
}

export interface VaultView {
  id: number;
  funder: string;
  recipient: string;
  token: string;
  decimals: number;

  /** Base-unit (stroop) amounts, as decimal strings. */
  totalAmount: string;
  amountPerMilestone: string;
  amountReleased: string;
  amountRemaining: string;
  lockedAmount: string;
  releasableAmount: string;

  /** The same amounts rendered with `decimals` applied. */
  totalAmountDisplay: string;
  amountPerMilestoneDisplay: string;
  amountReleasedDisplay: string;
  amountRemainingDisplay: string;
  lockedAmountDisplay: string;
  releasableAmountDisplay: string;

  milestones: number;
  milestonesReleased: number;
  unlocksCompleted: number;

  /** Epoch seconds. */
  startTime: number;
  endTime: number;
  clawbackTime: number;
  nextUnlockTime: number | null;

  status: VaultStatus;
  /** Share of milestones released, 0-100. */
  progress: number;

  createdLedger: number;
  createdTxHash: string;
  createdAt: string;
  updatedAt: string;

  timeline: MilestoneView[];
  events?: VaultEventView[];
}

export type VaultWithMilestones = Vault & { milestonesRef: Milestone[] };
export type VaultWithDetails = VaultWithMilestones & { events: VaultEvent[] };

export interface ListVaultsOptions {
  limit: number;
  offset: number;
  status?: VaultStatus;
  funder?: string;
  recipient?: string;
  token?: string;
}

const isActive = (status: string): boolean => status === VAULT_STATUS.Active;

export function toMilestoneViews(
  vault: Vault,
  milestones: Milestone[],
  now: number,
  decimals: number,
): MilestoneView[] {
  return [...milestones]
    .sort((a, b) => a.index - b.index)
    .map((milestone) => {
      const unlockTime = Number(milestone.unlockTime);
      const releasable = isActive(vault.status) && !milestone.released && unlockTime <= now;

      let state: MilestoneState;
      if (milestone.released) state = "released";
      else if (releasable) state = "releasable";
      else if (!isActive(vault.status)) state = "cancelled";
      else state = "locked";

      return {
        index: milestone.index,
        amount: milestone.amount,
        amountDisplay: formatUnits(BigInt(milestone.amount), decimals),
        unlockTime,
        released: milestone.released,
        releasedAt: milestone.releasedAt === null ? null : Number(milestone.releasedAt),
        releaseTxHash: milestone.releaseTxHash,
        releasable,
        state,
      };
    });
}

export function toVaultView(
  vault: VaultWithMilestones,
  now: number,
  decimals: number,
  events?: VaultEvent[],
): VaultView {
  const totalAmount = BigInt(vault.totalAmount);
  const amountReleased = BigInt(vault.amountReleased);
  const amountRemaining = totalAmount - amountReleased;

  const timeline = toMilestoneViews(vault, vault.milestonesRef, now, decimals);
  const releasableAmount = timeline.reduce(
    (sum, milestone) => (milestone.releasable ? sum + BigInt(milestone.amount) : sum),
    0n,
  );
  const lockedAmount = amountRemaining - releasableAmount;

  const unlocksCompleted = timeline.filter((milestone) => milestone.unlockTime <= now).length;
  const nextUnlock = timeline.find(
    (milestone) => !milestone.released && milestone.unlockTime > now,
  );

  const progress =
    vault.milestones === 0
      ? 0
      : Math.round((vault.milestonesReleased / vault.milestones) * 10_000) / 100;

  const display = (value: bigint): string => formatUnits(value, decimals);
  const startTime = Number(vault.startTime);

  return {
    id: vault.id,
    funder: vault.funder,
    recipient: vault.recipient,
    token: vault.token,
    decimals,

    totalAmount: totalAmount.toString(),
    amountPerMilestone: vault.amountPerMilestone,
    amountReleased: amountReleased.toString(),
    amountRemaining: amountRemaining.toString(),
    lockedAmount: lockedAmount.toString(),
    releasableAmount: releasableAmount.toString(),

    totalAmountDisplay: display(totalAmount),
    amountPerMilestoneDisplay: display(BigInt(vault.amountPerMilestone)),
    amountReleasedDisplay: display(amountReleased),
    amountRemainingDisplay: display(amountRemaining),
    lockedAmountDisplay: display(lockedAmount),
    releasableAmountDisplay: display(releasableAmount),

    milestones: vault.milestones,
    milestonesReleased: vault.milestonesReleased,
    unlocksCompleted,

    startTime,
    endTime: startTime + vault.duration,
    clawbackTime: Number(vault.clawbackTime),
    nextUnlockTime: nextUnlock?.unlockTime ?? null,

    status: vault.status as VaultStatus,
    progress,

    createdLedger: vault.createdLedger,
    createdTxHash: vault.createdTxHash,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),

    timeline,
    ...(events === undefined
      ? {}
      : {
          events: events.map((event) => ({
            eventId: event.eventId,
            kind: event.kind,
            topic: event.topic,
            ledger: event.ledger,
            txHash: event.txHash,
            occurredAt: Number(event.occurredAt),
            payload: JSON.parse(event.payload) as unknown,
          })),
        }),
  };
}

export async function listVaults(
  prisma: PrismaClient,
  options: ListVaultsOptions,
  decimals: number,
  now = Math.floor(Date.now() / 1000),
): Promise<{ items: VaultView[]; total: number }> {
  const where = {
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.funder === undefined ? {} : { funder: options.funder }),
    ...(options.recipient === undefined ? {} : { recipient: options.recipient }),
    ...(options.token === undefined ? {} : { token: options.token }),
  };

  const [items, total] = await Promise.all([
    prisma.vault.findMany({
      where,
      include: { milestonesRef: true },
      orderBy: { id: "desc" },
      take: options.limit,
      skip: options.offset,
    }),
    prisma.vault.count({ where }),
  ]);

  return { items: items.map((vault) => toVaultView(vault, now, decimals)), total };
}

export async function getVault(
  prisma: PrismaClient,
  id: number,
  decimals: number,
  now = Math.floor(Date.now() / 1000),
): Promise<VaultView | null> {
  const vault = await prisma.vault.findUnique({
    where: { id },
    include: { milestonesRef: true },
  });

  if (!vault) return null;

  // The event log intentionally has no foreign key to Vault (see the Prisma
  // schema), so events are loaded explicitly instead of through a relation.
  const events = await prisma.vaultEvent.findMany({
    where: { vaultId: id },
    orderBy: { id: "asc" },
  });

  return toVaultView(vault, now, decimals, events);
}
