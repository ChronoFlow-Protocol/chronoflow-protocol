/**
 * Freighter wallet helpers.
 *
 * Freighter's API never rejects: it resolves with an `error` field alongside the
 * payload, so every call is unwrapped here into either a value or a thrown
 * `WalletError`. That keeps the React layer free of `error &&` checks.
 */

import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction as freighterSignTransaction,
} from "@stellar/freighter-api";

export class WalletError extends Error {
  readonly code: string;

  constructor(message: string, code = "WALLET_ERROR") {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

interface FreighterErrorLike {
  code?: number | string;
  message?: string;
}

/** Turns Freighter's `{ code, message }` error into a `WalletError`. */
function toWalletError(error: unknown, fallback: string): WalletError {
  const shaped = (error ?? {}) as FreighterErrorLike;
  const message =
    typeof shaped.message === "string" && shaped.message.length > 0 ? shaped.message : fallback;
  return new WalletError(message, shaped.code === undefined ? "WALLET_ERROR" : String(shaped.code));
}

export const isBrowser = (): boolean => typeof window !== "undefined";

/** True when the Freighter extension is installed and reachable. */
export async function isWalletAvailable(): Promise<boolean> {
  if (!isBrowser()) return false;
  const { isConnected: connected } = await isConnected();
  return connected;
}

/** True when this origin was already granted access (no popup needed). */
export async function isWalletAuthorized(): Promise<boolean> {
  if (!isBrowser()) return false;
  const { isAllowed: allowed, error } = await isAllowed();
  if (error) return false;
  return allowed;
}

/** Prompts Freighter for access and returns the selected address. */
export async function connectWallet(): Promise<string> {
  if (!isBrowser()) throw new WalletError("Freighter can only be used in a browser.");

  const { address, error } = await requestAccess();
  if (error) throw toWalletError(error, "Freighter refused the connection request.");
  if (!address) throw new WalletError("Freighter returned no address.");
  return address;
}

/** Returns the address already shared with this origin, or `null`. */
export async function currentAddress(): Promise<string | null> {
  if (!isBrowser()) return null;

  const { isAllowed: allowed } = await isAllowed();
  if (!allowed) return null;

  const { address, error } = await getAddress();
  if (error || !address) return null;
  return address;
}

export interface WalletNetwork {
  network: string;
  networkPassphrase: string;
}

/** Network the wallet is currently pointed at. */
export async function walletNetwork(): Promise<WalletNetwork | null> {
  if (!isBrowser()) return null;

  const { network, networkPassphrase, error } = await getNetworkDetails();
  if (error) return null;
  return { network, networkPassphrase };
}

/**
 * Signs a transaction envelope XDR with the wallet.
 *
 * Freighter signs the envelope *and* any Soroban authorization entries that
 * belong to the signing account, which is what the escrow's funder auth needs.
 */
export async function signTransactionXdr(
  transactionXdr: string,
  options: { address: string; networkPassphrase: string },
): Promise<string> {
  const { signedTxXdr, error } = await freighterSignTransaction(transactionXdr, {
    address: options.address,
    networkPassphrase: options.networkPassphrase,
  });

  if (error) throw toWalletError(error, "Freighter declined to sign the transaction.");
  if (!signedTxXdr) throw new WalletError("Freighter returned no signed transaction.");
  return signedTxXdr;
}
