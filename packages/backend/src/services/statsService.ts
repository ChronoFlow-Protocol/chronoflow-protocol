import type { PrismaClient } from "@prisma/client";

import { VAULT_STATUS } from "../generated/chronoflow.js";
import { formatUnits } from "../lib/values.js";
import type { IndexerSnapshot } from "../indexer/indexer.js";

export interface TokenStats {
  token: string;
  vaults: number;
  escrowed: string;
  escrowedDisplay: string;
  released: string;
  releasedDisplay: string;
  locked: string;
  lockedDisplay: string;
}

export interface StatsView {
  network: string;
  contractId: string;
  decimals: number;
  generatedAt: string;
  indexer: IndexerSnapshot;
  totals: {
    vaults: number;
    activeVaults: number;
    completedVaults: number;
    clawedBackVaults: number;
    milestones: number;
    milestonesReleased: number;
    uniqueFunders: number;
    uniqueRecipients: number;
    uniqueTokens: number;
  };
  amounts: {
    escrowed: string;
    escrowedDisplay: string;
    released: string;
    releasedDisplay: string;
    locked: string;
    lockedDisplay: string;
    clawedBack: string;
    clawedBackDisplay: string;
    /** Released plus currently releasable, across all vaults. */
    streamed: string;
    streamedDisplay: string;
  };
  tokens: TokenStats[];
}

export interface StatsContext {
  network: string;
  contractId: string;
  decimals: number;
  indexer: IndexerSnapshot;
  now?: number;
}

/**
 * Aggregates protocol-wide numbers.
 *
 * Amounts are summed in JavaScript as bigints: vault amounts are i128, so they
 * must never pass through a float. Vault counts here are in the thousands at
 * most; if the protocol grows past that, move these sums into SQL.
 */
export async function getStats(prisma: PrismaClient, context: StatsContext): Promise<StatsView> {
  const vaults = await prisma.vault.findMany({
    select: {
      funder: true,
      recipient: true,
      token: true,
      totalAmount: true,
      amountReleased: true,
      status: true,
      milestones: true,
      milestonesReleased: true,
    },
  });

  const funders = new Set<string>();
  const recipients = new Set<string>();
  const byToken = new Map<string, TokenStats & { escrowedRaw: bigint; releasedRaw: bigint }>();

  let escrowed = 0n;
  let released = 0n;
  let locked = 0n;
  let clawedBack = 0n;
  let milestones = 0;
  let milestonesReleased = 0;

  for (const vault of vaults) {
    const total = BigInt(vault.totalAmount);
    const releasedAmount = BigInt(vault.amountReleased);
    const remaining = total - releasedAmount;

    funders.add(vault.funder);
    recipients.add(vault.recipient);
    milestones += vault.milestones;
    milestonesReleased += vault.milestonesReleased;

    escrowed += total;
    released += releasedAmount;

    if (vault.status === VAULT_STATUS.ClawedBack) {
      clawedBack += remaining;
    } else if (vault.status === VAULT_STATUS.Active) {
      locked += remaining;
    }

    const tokenEntry = byToken.get(vault.token) ?? {
      token: vault.token,
      vaults: 0,
      escrowed: "0",
      escrowedDisplay: "0",
      released: "0",
      releasedDisplay: "0",
      locked: "0",
      lockedDisplay: "0",
      escrowedRaw: 0n,
      releasedRaw: 0n,
    };
    tokenEntry.vaults += 1;
    tokenEntry.escrowedRaw += total;
    tokenEntry.releasedRaw += releasedAmount;
    byToken.set(vault.token, tokenEntry);
  }

  const display = (value: bigint): string => formatUnits(value, context.decimals);
  const tokens = [...byToken.values()]
    .map((entry) => {
      const tokenLocked = entry.escrowedRaw - entry.releasedRaw;
      return {
        token: entry.token,
        vaults: entry.vaults,
        escrowed: entry.escrowedRaw.toString(),
        escrowedDisplay: display(entry.escrowedRaw),
        released: entry.releasedRaw.toString(),
        releasedDisplay: display(entry.releasedRaw),
        locked: tokenLocked.toString(),
        lockedDisplay: display(tokenLocked),
      } satisfies TokenStats;
    })
    .sort((a, b) => Number(BigInt(b.escrowed) - BigInt(a.escrowed)));

  return {
    network: context.network,
    contractId: context.contractId,
    decimals: context.decimals,
    generatedAt: new Date().toISOString(),
    indexer: context.indexer,
    totals: {
      vaults: vaults.length,
      activeVaults: vaults.filter((vault) => vault.status === VAULT_STATUS.Active).length,
      completedVaults: vaults.filter((vault) => vault.status === VAULT_STATUS.Completed).length,
      clawedBackVaults: vaults.filter((vault) => vault.status === VAULT_STATUS.ClawedBack).length,
      milestones,
      milestonesReleased,
      uniqueFunders: funders.size,
      uniqueRecipients: recipients.size,
      uniqueTokens: byToken.size,
    },
    amounts: {
      escrowed: escrowed.toString(),
      escrowedDisplay: display(escrowed),
      released: released.toString(),
      releasedDisplay: display(released),
      locked: locked.toString(),
      lockedDisplay: display(locked),
      clawedBack: clawedBack.toString(),
      clawedBackDisplay: display(clawedBack),
      streamed: released.toString(),
      streamedDisplay: display(released),
    },
    tokens,
  };
}
