/* eslint-disable */
/* biome-ignore-all lint: generated from the compiled contract spec */

/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 *
 * Sources:
 *   packages/contracts/contracts/chronoflow-escrow/src/lib.rs   (contract source)
 *   packages/contracts/wasm/chronoflow_escrow.wasm             (compiled spec)
 *   packages/contracts/deployments/registry.json               (deployments)
 *
 * Regenerate with:
 *   pnpm --filter @chronoflow/contracts run export        # config only
 *   pnpm --filter @chronoflow/contracts run deploy:testnet  # deploy + config
 *
 * Field names follow the contract spec (snake_case) so they line up exactly
 * with the objects `scValToNative` returns from the Soroban RPC, and event
 * topic symbols are read from the spec's prefix topics.
 */

export const CONTRACT_NAME = "chronoflow-escrow";

/** Soroban method names, excluding `__constructor`. */
export const CONTRACT_METHODS = [
  "admin",
  "clawback",
  "clawbackDelay",
  "createVault",
  "getVault",
  "isPaused",
  "nextVaultId",
  "releasableAmount",
  "releaseMilestone",
  "setClawbackDelay",
  "setPaused",
  "unlockTime",
  "vaultCount",
  "vaultMilestones",
] as const;

export type ContractMethod = (typeof CONTRACT_METHODS)[number];

/** camelCase → Soroban method name. */
export const METHODS = {
  /** `admin()` */
  admin: "admin",
  /** `clawback(vault_id: bigint)` */
  clawback: "clawback",
  /** `get_vault(vault_id: bigint)` */
  getVault: "get_vault",
  /** `is_paused()` */
  isPaused: "is_paused",
  /** `set_paused(paused: boolean)` */
  setPaused: "set_paused",
  /** `unlock_time(vault_id: bigint, milestone_index: number)` */
  unlockTime: "unlock_time",
  /** `vault_count()` */
  vaultCount: "vault_count",
  /** `create_vault(funder: string, recipient: string, token: string, amount: bigint, duration: bigint, milestones: number)` */
  createVault: "create_vault",
  /** `next_vault_id()` */
  nextVaultId: "next_vault_id",
  /** `clawback_delay()` */
  clawbackDelay: "clawback_delay",
  /** `vault_milestones(vault_id: bigint)` */
  vaultMilestones: "vault_milestones",
  /** `releasable_amount(vault_id: bigint)` */
  releasableAmount: "releasable_amount",
  /** `release_milestone(vault_id: bigint)` */
  releaseMilestone: "release_milestone",
  /** `set_clawback_delay(new_delay: bigint)` */
  setClawbackDelay: "set_clawback_delay",
} as const;

/** Contract error codes (`ContractError(n)` in diagnostics). */
export const ERROR_CODES = {
  NotInitialized: 1,
  InvalidDuration: 2,
  InvalidMilestoneCount: 3,
  InvalidAmount: 4,
  VaultNotFound: 5,
  VaultNotActive: 6,
  MilestoneLocked: 7,
  NoMilestonesRemaining: 8,
  ClawbackTooEarly: 9,
  ContractPaused: 10,
  MilestoneIndexOutOfBounds: 11,
} as const;

export type ContractErrorName = keyof typeof ERROR_CODES;

/** Numeric code → error name. */
export const ERROR_NAMES: Record<number, ContractErrorName> = {
  1: "NotInitialized",
  2: "InvalidDuration",
  3: "InvalidMilestoneCount",
  4: "InvalidAmount",
  5: "VaultNotFound",
  6: "VaultNotActive",
  7: "MilestoneLocked",
  8: "NoMilestonesRemaining",
  9: "ClawbackTooEarly",
  10: "ContractPaused",
  11: "MilestoneIndexOutOfBounds",
};

/** `VaultCreated` — topics start with `"vault_created"`. */
export interface VaultCreatedEvent {
  /** `u64` — topic */
  vault_id: bigint;
  /** `address` — topic */
  funder: string;
  /** `address` — topic */
  recipient: string;
  /** `address` — data */
  token: string;
  /** `i128` — data */
  total_amount: bigint;
  /** `i128` — data */
  amount_per_milestone: bigint;
  /** `u32` — data */
  milestones: number;
  /** `u64` — data */
  start_time: bigint;
  /** `u64` — data */
  duration: bigint;
  /** `u64` — data */
  clawback_time: bigint;
}

/** `VaultCompleted` — topics start with `"vault_completed"`. */
export interface VaultCompletedEvent {
  /** `u64` — topic */
  vault_id: bigint;
  /** `i128` — data */
  total_released: bigint;
  /** `u64` — data */
  completed_at: bigint;
}

/** `VaultClawedBack` — topics start with `"vault_clawed_back"`. */
export interface VaultClawedBackEvent {
  /** `u64` — topic */
  vault_id: bigint;
  /** `address` — topic */
  funder: string;
  /** `i128` — data */
  amount: bigint;
  /** `u64` — data */
  clawed_back_at: bigint;
}

/** `MilestoneReleased` — topics start with `"milestone_released"`. */
export interface MilestoneReleasedEvent {
  /** `u64` — topic */
  vault_id: bigint;
  /** `u32` — topic */
  milestone_index: number;
  /** `address` — topic */
  recipient: string;
  /** `i128` — data */
  amount: bigint;
  /** `u64` — data */
  released_at: bigint;
}

/** `ClawbackDelayUpdated` — topics start with `"clawback_delay_updated"`. */
export interface ClawbackDelayUpdatedEvent {
  /** `address` — topic */
  admin: string;
  /** `u64` — data */
  previous_delay: bigint;
  /** `u64` — data */
  new_delay: bigint;
}

/** `ContractPauseToggled` — topics start with `"contract_pause_toggled"`. */
export interface ContractPauseToggledEvent {
  /** `address` — topic */
  admin: string;
  /** `bool` — data */
  paused: boolean;
}


/**
 * Event shapes as published by the contract.
 *
 * `topicFields` are carried in the event topics (after `topic`),
 * `dataFields` live in the event's data map.
 */
export interface ContractEventShape {
  /** First topic of the event — what the indexer filters on. */
  topic: string;
  /** Rust type name of the event. */
  specName: string;
  /** Fixed topics published before the topic fields. */
  prefixTopics: readonly string[];
  /** How the data section is encoded: map, vec or single-value. */
  dataFormat: string;
  /** Fields carried in the event topics, after the prefix topics. */
  topicFields: readonly string[];
  /** Fields carried in the event's data section. */
  dataFields: readonly string[];
}

export const EVENTS: Record<string, ContractEventShape> = {
  vault_created: {
    topic: "vault_created",
    specName: "VaultCreated",
    prefixTopics: ["vault_created"],
    dataFormat: "map",
    topicFields: ["vault_id", "funder", "recipient"],
    dataFields: ["token", "total_amount", "amount_per_milestone", "milestones", "start_time", "duration", "clawback_time"],
  },
  vault_completed: {
    topic: "vault_completed",
    specName: "VaultCompleted",
    prefixTopics: ["vault_completed"],
    dataFormat: "map",
    topicFields: ["vault_id"],
    dataFields: ["total_released", "completed_at"],
  },
  vault_clawed_back: {
    topic: "vault_clawed_back",
    specName: "VaultClawedBack",
    prefixTopics: ["vault_clawed_back"],
    dataFormat: "map",
    topicFields: ["vault_id", "funder"],
    dataFields: ["amount", "clawed_back_at"],
  },
  milestone_released: {
    topic: "milestone_released",
    specName: "MilestoneReleased",
    prefixTopics: ["milestone_released"],
    dataFormat: "map",
    topicFields: ["vault_id", "milestone_index", "recipient"],
    dataFields: ["amount", "released_at"],
  },
  clawback_delay_updated: {
    topic: "clawback_delay_updated",
    specName: "ClawbackDelayUpdated",
    prefixTopics: ["clawback_delay_updated"],
    dataFormat: "map",
    topicFields: ["admin"],
    dataFields: ["previous_delay", "new_delay"],
  },
  contract_pause_toggled: {
    topic: "contract_pause_toggled",
    specName: "ContractPauseToggled",
    prefixTopics: ["contract_pause_toggled"],
    dataFormat: "map",
    topicFields: ["admin"],
    dataFields: ["paused"],
  },
};

/** Topics the backend indexer subscribes to. */
export const INDEXED_EVENT_TOPICS = [
  "vault_created",
  "vault_completed",
  "vault_clawed_back",
  "milestone_released",
  "clawback_delay_updated",
  "contract_pause_toggled",
] as const;

/**
 * Storage keys for the contract.\n\n`Vault` is the only per-vault key; everything else is singleton\nconfiguration held in instance storage.
 *
 * Mirrors `DataKey` in the contract spec.
 */
export type DataKey = "Admin" | "ClawbackDelay" | "Paused" | "NextVaultId" | "Vault";

export const DATA_KEY = {
  Admin: "Admin",
  ClawbackDelay: "ClawbackDelay",
  Paused: "Paused",
  NextVaultId: "NextVaultId",
  Vault: "Vault",
} as const;

/**
 * Lifecycle of a vault.
 *
 * Mirrors `VaultStatus` in the contract spec.
 */
export type VaultStatus = "Active" | "Completed" | "ClawedBack";

export const VAULT_STATUS = {
  Active: "Active",
  Completed: "Completed",
  ClawedBack: "ClawedBack",
} as const;

/** Full vault record. */
export interface Vault {
  /** `i128` */
  amount_per_milestone: bigint;
  /** `i128` */
  amount_released: bigint;
  /** `u64` */
  clawback_time: bigint;
  /** `u64` */
  duration: bigint;
  /** `address` */
  funder: string;
  /** `u64` */
  id: bigint;
  /** `u32` */
  milestones: number;
  /** `u32` */
  milestones_released: number;
  /** `address` */
  recipient: string;
  /** `u64` */
  start_time: bigint;
  /** `[object Object]` */
  status: VaultStatus;
  /** `address` */
  token: string;
  /** `i128` */
  total_amount: bigint;
}

/** Timeline read model, one entry per milestone. */
export interface MilestoneView {
  /** `i128` */
  amount: bigint;
  /** `u32` */
  index: number;
  /** `bool` */
  releasable: boolean;
  /** `bool` */
  released: boolean;
  /** `u64` */
  unlock_time: bigint;
}

/** A recorded deployment of the escrow contract. */
export interface ContractDeployment {
  network: string;
  contractId: string;
  wasmHash?: string;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl?: string;
  /** Stellar Asset Contract of the native asset on this network, when known. */
  nativeAssetContractId?: string;
  deployedAt: string;
  /** Ledger the contract was created in; the indexer scans forward from here. */
  deployedLedger?: number;
  sourceAccount?: string;
}

/** Every known deployment, keyed by network name. */
export const DEPLOYMENTS: Record<string, ContractDeployment> = {
  "local": {
    network: "local",
    contractId: "",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
    friendbotUrl: "http://localhost:8000/friendbot",
    deployedAt: "",
  },
  "mainnet": {
    network: "mainnet",
    contractId: "",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    deployedAt: "",
  },
  "testnet": {
    network: "testnet",
    contractId: "CBF23UKGPOWZWMJCWNUTSHGXFGHJF62HDF3KRX633HJUIT7GJXDN7JTJ",
    wasmHash: "095f5fc3fd00ada4c4e6d2ff34348299cd5fa99f3ddb0bc6d50da7d0967f3482",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
    deployedAt: "2026-09-15T18:31:53.002Z",
    deployedLedger: 4694705,
    sourceAccount: "chronoflow-deployer",
  },
};

/** Network this export was generated for. */
export const NETWORK = "testnet";

export const ACTIVE_DEPLOYMENT: ContractDeployment | null = DEPLOYMENTS[NETWORK] ?? null;

/** Contract id on `NETWORK`, or an empty string when not deployed yet. */
export const CONTRACT_ID = ACTIVE_DEPLOYMENT?.contractId ?? "";

export const RPC_URL = ACTIVE_DEPLOYMENT?.rpcUrl ?? "";

export const NETWORK_PASSPHRASE = ACTIVE_DEPLOYMENT?.networkPassphrase ?? "";

export const FRIENDBOT_URL = ACTIVE_DEPLOYMENT?.friendbotUrl ?? "";

/** Ledger the active contract was created in, or 0 when unknown. */
export const DEPLOYED_LEDGER = ACTIVE_DEPLOYMENT?.deployedLedger ?? 0;

/**
 * Stellar Asset Contract for the native asset (XLM) on {@link NETWORK}, or an
 * empty string when the network has none (for example a local standalone node,
 * where the asset must be deployed first).
 */
export const NATIVE_ASSET_CONTRACT_ID = ACTIVE_DEPLOYMENT?.nativeAssetContractId ?? "";

/** True when this network has a deployed contract. */
export const IS_DEPLOYED = CONTRACT_ID.length > 0;
