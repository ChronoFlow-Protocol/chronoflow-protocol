/**
 * Shapes of the ChronoFlow indexer API.
 *
 * These mirror `packages/backend/src/services/*` — the dApp is a read-only client
 * of the REST API for list/stat views, and talks to the contract directly for
 * writes (see `src/lib/soroban.ts`).
 */

export type MilestoneState = "locked" | "releasable" | "released" | "cancelled";

export type VaultStatus = "Active" | "Completed" | "ClawedBack";

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

  totalAmount: string;
  amountPerMilestone: string;
  amountReleased: string;
  amountRemaining: string;
  lockedAmount: string;
  releasableAmount: string;

  totalAmountDisplay: string;
  amountPerMilestoneDisplay: string;
  amountReleasedDisplay: string;
  amountRemainingDisplay: string;
  lockedAmountDisplay: string;
  releasableAmountDisplay: string;

  milestones: number;
  milestonesReleased: number;
  unlocksCompleted: number;
  startTime: number;
  endTime: number;
  clawbackTime: number;
  nextUnlockTime: number | null;

  status: VaultStatus;
  progress: number;

  createdLedger: number;
  createdTxHash: string;
  createdAt: string;
  updatedAt: string;

  timeline: MilestoneView[];
  events?: VaultEventView[];
}

export interface TokenStatsView {
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
  indexer: {
    running: boolean;
    network: string;
    contractId: string;
    rpcUrl: string;
    lastLedger: number;
    latestLedger: number;
    lastPollAt: string | null;
    lastError: string | null;
    eventsIngested: number;
    eventsScanned: number;
  };
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
    streamed: string;
    streamedDisplay: string;
  };
  tokens: TokenStatsView[];
}

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
  decimals: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: ListMeta;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/** Raw vault record as returned by the contract's `get_vault`. */
export interface OnChainVault {
  id: bigint;
  funder: string;
  recipient: string;
  token: string;
  total_amount: bigint;
  amount_per_milestone: bigint;
  amount_released: bigint;
  milestones: number;
  milestones_released: number;
  start_time: bigint;
  duration: bigint;
  clawback_time: bigint;
  status: string;
}
