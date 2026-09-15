/**
 * Soroban client for the ChronoFlow escrow contract.
 *
 * Writes follow the standard Stellar dApp flow:
 *   build → `prepareTransaction` (simulate + assemble footprint/auth) → wallet
 *   signs → submit → poll until the ledger closes.
 *
 * Reads simulate the call locally and decode the return value, so the UI can
 * show live contract state even when the indexer API is not running.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { ERROR_CODES, ERROR_NAMES } from "@/generated/chronoflow";
import { stellarConfig } from "./config";
import type { OnChainVault } from "./types";

export class SorobanError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "SorobanError";
    if (code !== undefined) this.code = code;
  }
}

export const server = new rpc.Server(stellarConfig.rpcUrl, {
  allowHttp: stellarConfig.rpcUrl.startsWith("http://"),
});

/** Human-readable copy for every error the contract can return. */
const CONTRACT_ERROR_HINTS: Record<string, string> = {
  NotInitialized: "The escrow contract has not been initialised yet.",
  InvalidDuration: "The duration must be greater than zero.",
  InvalidMilestoneCount: "Choose between 1 and 100 milestones.",
  InvalidAmount: "The amount must be positive and split evenly across the milestones.",
  VaultNotFound: "No vault exists with that id.",
  VaultNotActive: "This vault is no longer active.",
  MilestoneLocked: "The next milestone has not unlocked yet — wait for its unlock time.",
  NoMilestonesRemaining: "Every milestone of this vault has already been released.",
  ClawbackTooEarly: "The clawback grace period has not elapsed yet.",
  ContractPaused: "The protocol is paused, so new vaults and releases are disabled.",
  MilestoneIndexOutOfBounds: "That milestone index is outside the vault's schedule.",
};

/**
 * Rewrites a raw Soroban failure into something a user can act on.
 *
 * Host failures arrive as `HostError: Error(Contract, #7)`; the numeric code is
 * mapped back to the Rust variant through the generated spec.
 */
export function describeSorobanError(raw: string): string {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(raw);
  const code = match?.[1];
  if (code !== undefined) {
    const name = ERROR_NAMES[Number(code)];
    if (name) {
      const hint = CONTRACT_ERROR_HINTS[name];
      return hint ? `${hint} (${name})` : `Contract rejected the call: ${name}.`;
    }
  }

  if (/insufficient/i.test(raw)) return `Insufficient balance: ${raw}`;
  return raw;
}

function contractClient(): Contract {
  if (!stellarConfig.isDeployed) {
    throw new SorobanError(
      "No escrow contract is configured. Deploy one with `pnpm --filter @chronoflow/contracts run deploy:testnet`.",
      "NOT_DEPLOYED",
    );
  }
  return new Contract(stellarConfig.contractId);
}

const scAddress = (value: string): xdr.ScVal => new Address(value).toScVal();
const scI128 = (value: bigint): xdr.ScVal => nativeToScVal(value, { type: "i128" });
const scU64 = (value: number | bigint): xdr.ScVal => nativeToScVal(BigInt(value), { type: "u64" });
const scU32 = (value: number): xdr.ScVal => nativeToScVal(value, { type: "u32" });

/** Signs a prepared (assembled) envelope, returning the signed XDR. */
export type Signer = (preparedXdr: string) => Promise<string>;

export interface TxOutcome {
  hash: string;
  ledger: number;
  /** Decoded `returnValue` of the contract call, when it returned one. */
  returnValue: unknown;
  explorerUrl: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `getTransaction` until the ledger closes the submitted transaction. */
async function waitForTransaction(
  hash: string,
  attempts = 25,
  intervalMs = 1_500,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: rpc.Api.GetTransactionResponse;
    try {
      response = await server.getTransaction(hash);
    } catch (error) {
      throw new SorobanError(`Could not read transaction ${hash}: ${String(error)}`);
    }

    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) return response;
    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new SorobanError(
        `The transaction failed on-chain (${hash}). It was simulated successfully, so the ledger state changed in between — refresh and try again.`,
        "TX_FAILED",
      );
    }

    await sleep(intervalMs);
  }

  throw new SorobanError(
    `Timed out waiting for ${hash} to be included in a ledger. Check the explorer for its status.`,
    "TX_TIMEOUT",
  );
}

interface SubmitInput {
  /** Account that pays the fee and whose sequence number is consumed. */
  source: string;
  method: string;
  args: xdr.ScVal[];
  signer: Signer;
}

/** Builds, simulates, signs, submits and confirms a state-changing call. */
async function submit({ source, method, args, signer }: SubmitInput): Promise<TxOutcome> {
  let account: Account;
  try {
    account = await server.getAccount(source);
  } catch {
    throw new SorobanError(
      `Account ${source} is not funded on ${stellarConfig.network}. Fund it with Friendbot first.`,
      "ACCOUNT_NOT_FUNDED",
    );
  }

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellarConfig.networkPassphrase,
  })
    .addOperation(contractClient().call(method, ...args))
    .setTimeout(120)
    .build();

  let prepared: Transaction;
  try {
    prepared = await server.prepareTransaction(transaction);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    throw new SorobanError(describeSorobanError(raw), "SIMULATION_FAILED");
  }

  const signedXdr = await signer(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(
    signedXdr,
    stellarConfig.networkPassphrase,
  ) as Transaction;

  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new SorobanError(
      `The network rejected the transaction: ${JSON.stringify(sent.errorResult)}`,
    );
  }

  const confirmed = await waitForTransaction(sent.hash);
  return {
    hash: sent.hash,
    ledger: confirmed.ledger,
    returnValue: confirmed.returnValue ? scValToNative(confirmed.returnValue) : null,
    explorerUrl: stellarConfig.explorer.tx(sent.hash),
  };
}

/** Reads a value from the contract by simulating a call (no fee, no signature). */
async function simulateRead(method: string, args: xdr.ScVal[]): Promise<unknown> {
  // Read-only calls need no auth, so an unfunded throwaway account is enough
  // and avoids requiring a connected wallet just to render the dashboard.
  const account = new Account(Keypair.random().publicKey(), "0");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellarConfig.networkPassphrase,
  })
    .addOperation(contractClient().call(method, ...args))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new SorobanError(describeSorobanError(simulation.error), "SIMULATION_FAILED");
  }
  if (!simulation.result) {
    throw new SorobanError(`The contract returned no value for ${method}.`, "EMPTY_RESULT");
  }

  return scValToNative(simulation.result.retval);
}

export interface CreateVaultInput {
  funder: string;
  recipient: string;
  token: string;
  /** Total deposit in base units (stroops). */
  amount: bigint;
  /** Seconds from creation to the final unlock. */
  duration: number;
  /** Number of equal milestones (1–12 on-chain). */
  milestones: number;
  signer: Signer;
}

/** `create_vault` — locks `amount` of `token` and starts the milestone stream. */
export async function createVault(input: CreateVaultInput): Promise<TxOutcome> {
  return submit({
    source: input.funder,
    method: "create_vault",
    args: [
      scAddress(input.funder),
      scAddress(input.recipient),
      scAddress(input.token),
      scI128(input.amount),
      scU64(input.duration),
      scU32(input.milestones),
    ],
    signer: input.signer,
  });
}

/**
 * `release_milestone` — pays the next unlocked milestone to the recipient.
 *
 * Permissionless on-chain: anyone (the recipient, the funder or a keeper) can
 * trigger it, and the payout always goes to the vault's recipient.
 */
export async function releaseMilestone(input: {
  vaultId: number;
  source: string;
  signer: Signer;
}): Promise<TxOutcome> {
  return submit({
    source: input.source,
    method: "release_milestone",
    args: [scU64(input.vaultId)],
    signer: input.signer,
  });
}

/** `clawback` — returns unclaimed funds to the funder after the grace period. */
export async function clawbackVault(input: {
  vaultId: number;
  source: string;
  signer: Signer;
}): Promise<TxOutcome> {
  return submit({
    source: input.source,
    method: "clawback",
    args: [scU64(input.vaultId)],
    signer: input.signer,
  });
}

/** `get_vault` — live vault record straight from the contract. */
export async function readVault(vaultId: number): Promise<OnChainVault | null> {
  try {
    const value = await simulateRead("get_vault", [scU64(vaultId)]);
    return (value ?? null) as OnChainVault | null;
  } catch (error) {
    if (error instanceof SorobanError && error.message.includes("VaultNotFound")) return null;
    throw error;
  }
}

/** `vault_count` — number of vaults created so far. */
export async function readVaultCount(): Promise<number> {
  const value = await simulateRead("vault_count", []);
  return Number(value ?? 0);
}

/** `milestone_unlock_time` — authoritative unlock timestamp for a milestone. */
export async function readMilestoneUnlockTime(
  vaultId: number,
  milestoneIndex: number,
): Promise<number> {
  const value = await simulateRead("unlock_time", [scU64(vaultId), scU32(milestoneIndex)]);
  return Number(value ?? 0);
}

export { ERROR_CODES };
