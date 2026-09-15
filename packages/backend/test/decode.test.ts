import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { decodeEvent, toRawEvent } from "../src/indexer/decode.js";
import { asBigInt, asNumber, asString } from "../src/lib/values.js";
import { findEvent, loadDecodedEvents, loadRawEvents, loadSdkEvents } from "./helpers/fixture.js";

describe("toRawEvent", () => {
  it("maps RPC responses and drops failed invocations", () => {
    const [first] = loadSdkEvents();
    expect(toRawEvent(first)).not.toBeNull();
    expect(
      toRawEvent({
        ...(first as object),
        inSuccessfulContractCall: false,
        topic: [],
        value: undefined,
      }),
    ).toBeNull();
    expect(toRawEvent({ ledger: 1, txHash: "abc", topic: [], value: undefined })).toBeNull();
    expect(toRawEvent(null)).toBeNull();
  });

  it("converts the ledger close time to epoch seconds", () => {
    const event = toRawEvent(loadSdkEvents()[0]);
    expect(event?.ledgerClosedAt).toBeGreaterThan(1_600_000_000);
  });
});

describe("decodeEvent", () => {
  const raw = loadRawEvents();
  const decoded = loadDecodedEvents();

  it("decodes every event the contract emitted", () => {
    expect(decoded).toHaveLength(raw.length);
    expect(decoded.every((event) => event.eventId.length > 0)).toBe(true);
    expect(decoded.every((event) => event.topic.length > 0)).toBe(true);
  });

  it("decodes vault_created with spec field names", () => {
    const event = findEvent(decoded, "vault_created");

    expect(event.specName).toBe("VaultCreated");
    expect(asString(event.payload.funder, "funder")).toMatch(/^G[A-Z2-7]{55}$/);
    expect(asString(event.payload.recipient, "recipient")).toMatch(/^G[A-Z2-7]{55}$/);
    expect(asString(event.payload.token, "token")).toMatch(/^C[A-Z2-7]{55}$/);

    // Amounts and durations are integers of arbitrary width, so they must stay
    // exact rather than becoming floats.
    const vaultId = asNumber(event.payload.vault_id, "vault_id");
    const totalAmount = asBigInt(event.payload.total_amount, "total_amount");
    const duration = asBigInt(event.payload.duration, "duration");
    const milestones = asNumber(event.payload.milestones, "milestones");

    expect(vaultId).toBeGreaterThan(0);
    expect(totalAmount).toBeGreaterThan(0n);
    expect(duration).toBeGreaterThan(0n);
    expect(milestones).toBeGreaterThan(0);
    // The contract only accepts deposits that split evenly across milestones.
    expect(totalAmount % BigInt(milestones)).toBe(0n);
    expect(typeof event.payload.total_amount).toBe("bigint");
    expect(typeof event.payload.milestones).toBe("number");
  });

  it("separates topic fields from data fields", () => {
    const event = findEvent(decoded, "vault_created");

    // Topic fields are the ones the indexer can filter on.
    expect(event.payload.vault_id).toBeDefined();
    expect(event.payload.recipient).toBeDefined();
    // Data-only field.
    expect(event.payload.clawback_time).toBeDefined();
    expect(asBigInt(event.payload.clawback_time, "clawback_time")).toBeGreaterThan(
      asBigInt(event.payload.start_time, "start_time"),
    );
  });

  it("decodes milestone_released payloads", () => {
    const event = findEvent(decoded, "milestone_released");

    expect(event.specName).toBe("MilestoneReleased");
    expect(asNumber(event.payload.vault_id, "vault_id")).toBeGreaterThan(0);
    expect(asNumber(event.payload.milestone_index, "milestone_index")).toBeGreaterThanOrEqual(0);
    expect(asBigInt(event.payload.amount, "amount")).toBeGreaterThan(0n);
    expect(asBigInt(event.payload.released_at, "released_at")).toBeGreaterThan(1_600_000_000n);
  });

  it("carries ledger, tx hash and contract id", () => {
    for (const event of decoded) {
      expect(event.ledger).toBeGreaterThan(0);
      expect(event.txHash).toMatch(/^[0-9a-f]{64}$/);
      expect(event.contractId).toMatch(/^C[A-Z2-7]{55}$/);
      expect(event.occurredAt).toBeGreaterThan(0);
    }
  });

  it("returns null for unknown topics and malformed events", () => {
    const [first] = raw;
    expect(first).toBeDefined();
    if (!first) return;

    const unknownTopic = {
      ...first,
      topic: [xdr.ScVal.scvSymbol("not_a_chronoflow_event"), ...first.topic.slice(1)],
    };
    expect(decodeEvent(unknownTopic)).toBeNull();

    expect(decodeEvent({ ...first, topic: [] })).toBeNull();
  });
});
