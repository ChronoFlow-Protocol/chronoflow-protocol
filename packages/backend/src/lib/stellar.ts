import { rpc } from "@stellar/stellar-sdk";

/** Builds an RPC client for a Soroban endpoint (http:// allowed for local dev). */
export function createRpcServer(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
}

/**
 * A single event filter entry.
 *
 * When `topics` is set it is positional and every entry is a base64-encoded
 * `xdr.ScVal`: index 0 matches `topic[0]`, index 1 matches `topic[1]`, and so on.
 * A position may list at most four segments, and a request carries at most five
 * filters (both enforced by the RPC).
 */
export interface ContractEventFilter {
  type: "contract";
  contractIds: string[];
  topics?: string[][];
}

/**
 * Builds the RPC event filter for a contract.
 *
 * Deliberately unfiltered by topic: the RPC matches topic segments positionally
 * rather than as alternatives, so covering all six ChronoFlow event symbols
 * would need six filters — more than the five a request allows — and two round
 * trips per poll. The contract emits few events, and the decoder already drops
 * topics the indexer does not track, so a contract-wide filter is both simpler
 * and complete (admin events stay in the log too).
 */
export function createEventFilter(contractId: string): ContractEventFilter {
  return { type: "contract", contractIds: [contractId] };
}

export type { rpc };
