import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { xdr } from "@stellar/stellar-sdk";

import {
  decodeEvent,
  toRawEvent,
  type DecodedEvent,
  type RawSorobanEvent,
} from "../../src/indexer/decode.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, "..", "fixtures");

export interface FixtureEvent {
  id: string;
  ledger: number;
  txHash: string;
  contractId: string;
  ledgerClosedAt: string;
  inSuccessfulContractCall: boolean;
  topic: string[];
  value: string;
}

export interface Fixture {
  network: string;
  contractId: string;
  rpcUrl: string;
  capturedAt: string;
  startLedger: number;
  latestLedger: number;
  events: FixtureEvent[];
}

let cached: Fixture | undefined;

export function loadFixture(network = "testnet"): Fixture {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(join(FIXTURES_DIR, `${network}-events.json`), "utf8"),
    ) as Fixture;
  }
  return cached;
}

/**
 * Rehydrates the fixture into the shape `Server.getEvents` returns: the base64
 * topic/value payloads become `xdr.ScVal` instances again.
 */
export function loadSdkEvents(network = "testnet"): unknown[] {
  return loadFixture(network).events.map((event) => ({
    ...event,
    topic: event.topic.map((topic) => xdr.ScVal.fromXDR(topic, "base64")),
    value: xdr.ScVal.fromXDR(event.value, "base64"),
  }));
}

/** The fixture run through the RPC response mapper. */
export function loadRawEvents(network = "testnet"): RawSorobanEvent[] {
  return loadSdkEvents(network)
    .map((event) => toRawEvent(event))
    .filter((event): event is RawSorobanEvent => event !== null);
}

export function loadDecodedEvents(network = "testnet"): DecodedEvent[] {
  return loadRawEvents(network)
    .map((event) => decodeEvent(event))
    .filter((event): event is DecodedEvent => event !== null);
}

export function findEvent(events: DecodedEvent[], topic: string): DecodedEvent {
  const match = events.find((event) => event.topic === topic);
  if (!match) {
    throw new Error(
      `fixture does not contain a '${topic}' event (has: ${events.map((e) => e.topic).join(", ")})`,
    );
  }
  return match;
}
