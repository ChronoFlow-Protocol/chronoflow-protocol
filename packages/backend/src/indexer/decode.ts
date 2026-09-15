import { scValToNative, type xdr } from "@stellar/stellar-sdk";

import { EVENTS, type ContractEventShape } from "../generated/chronoflow.js";
import { asString } from "../lib/values.js";

/**
 * The subset of an RPC event the indexer relies on. Kept explicit so the
 * mapping from the SDK's response type is reviewed in one place (see
 * {@link toRawEvent}).
 */
export interface RawSorobanEvent {
  id: string;
  ledger: number;
  txHash: string;
  contractId: string;
  ledgerClosedAt: number;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

/** A contract event decoded into plain JavaScript values. */
export interface DecodedEvent {
  /** Stable RPC id, used to make ingestion idempotent. */
  eventId: string;
  /** First topic, e.g. `vault_created`. */
  topic: string;
  /** Rust type the event was generated from, e.g. `VaultCreated`. */
  specName: string;
  ledger: number;
  txHash: string;
  contractId: string;
  /** Ledger close time, in seconds since the epoch. */
  occurredAt: number;
  /** Topic + data fields merged, keyed by their spec (snake_case) names. */
  payload: Record<string, unknown>;
}

/**
 * Reads a contract id from an RPC event.
 *
 * The RPC client hands back a `Contract` instance (not a string) in recent SDK
 * versions, so prefer its `contractId()`/`toString()` rendering and fall back to
 * the raw string when the field is already decoded.
 */
function readContractId(value: unknown): string {
  if (typeof value === "string") return value;

  if (value !== null && typeof value === "object") {
    const renderable = value as { contractId?: unknown; toString?: unknown };
    try {
      if (typeof renderable.contractId === "function") {
        return String((renderable.contractId as () => string).call(value));
      }
      if (typeof renderable.toString === "function") {
        const rendered = String(value);
        if (/^C[A-Z2-7]{55}$/.test(rendered)) return rendered;
      }
    } catch {
      return "";
    }
  }

  return "";
}

/**
 * Converts an SDK event response into {@link RawSorobanEvent}.
 *
 * Returns `null` for events that are not from a successful contract call,
 * which the RPC includes for failed invocations.
 */
export function toRawEvent(event: unknown): RawSorobanEvent | null {
  if (event === null || typeof event !== "object") return null;

  const candidate = event as {
    id?: unknown;
    ledger?: unknown;
    txHash?: unknown;
    contractId?: unknown;
    ledgerClosedAt?: unknown;
    topic?: unknown;
    value?: unknown;
    inSuccessfulContractCall?: unknown;
  };

  if (candidate.inSuccessfulContractCall === false) return null;
  if (typeof candidate.ledger !== "number") return null;
  if (typeof candidate.txHash !== "string") return null;
  if (!Array.isArray(candidate.topic) || candidate.value === undefined) return null;

  const closedAt =
    typeof candidate.ledgerClosedAt === "string"
      ? Math.floor(new Date(candidate.ledgerClosedAt).getTime() / 1000)
      : typeof candidate.ledgerClosedAt === "number"
        ? candidate.ledgerClosedAt
        : 0;

  const topic = candidate.topic as xdr.ScVal[];
  const id =
    typeof candidate.id === "string" && candidate.id.length > 0
      ? candidate.id
      : `${candidate.ledger}-${candidate.txHash}-${topic.length}`;

  return {
    id,
    ledger: candidate.ledger,
    txHash: candidate.txHash,
    contractId: readContractId(candidate.contractId),
    ledgerClosedAt: closedAt,
    topic,
    value: candidate.value as xdr.ScVal,
  };
}

/**
 * Decodes a raw event against the contract spec.
 *
 * Returns `null` when the event is not one the indexer tracks, so unknown
 * events from the same contract are ignored instead of failing the batch.
 */
export function decodeEvent(raw: RawSorobanEvent): DecodedEvent | null {
  const [firstTopic, ...topicFields] = raw.topic;
  if (firstTopic === undefined) return null;

  let topicSymbol: string;
  try {
    topicSymbol = asString(scValToNative(firstTopic), "topic[0]");
  } catch {
    return null;
  }

  const shape: ContractEventShape | undefined = EVENTS[topicSymbol];
  if (!shape) return null;

  const payload: Record<string, unknown> = {};

  // Topic fields follow the fixed prefix topics, in spec order.
  shape.topicFields.forEach((name, index) => {
    const value = topicFields[index];
    payload[name] = value === undefined ? undefined : scValToNative(value);
  });

  const data = scValToNative(raw.value);
  if (shape.dataFormat === "map") {
    Object.assign(payload, data as Record<string, unknown>);
  } else if (shape.dataFormat === "vec") {
    (data as unknown[]).forEach((value, index) => {
      const name = shape.dataFields[index];
      if (name !== undefined) payload[name] = value;
    });
  } else {
    const name = shape.dataFields[0];
    if (name !== undefined) payload[name] = data;
  }

  return {
    eventId: raw.id,
    topic: topicSymbol,
    specName: shape.specName,
    ledger: raw.ledger,
    txHash: raw.txHash,
    contractId: raw.contractId,
    occurredAt: raw.ledgerClosedAt,
    payload,
  };
}
