import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DecodedEvent } from "../src/indexer/decode.js";
import { applyDecodedEvent } from "../src/indexer/handlers.js";
import { createTestPrisma, resetDatabase, seedEvents } from "./helpers/db.js";
import { loadDecodedEvents } from "./helpers/fixture.js";

describe("indexer projections", () => {
  let prisma: PrismaClient;
  const events = loadDecodedEvents();

  // Every expectation below is derived from the captured fixture, so re-recording
  // it against a fresh deployment does not break the suite.
  const createdEvents = events.filter((event) => event.topic === "vault_created");
  const releaseEvents = events.filter((event) => event.topic === "milestone_released");
  const releasesFor = (vaultId: number) =>
    releaseEvents.filter((event) => Number(event.payload.vault_id) === vaultId);

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it("projects VaultCreated into a vault and its milestone schedule", async () => {
    const applied = await seedEvents(prisma, events);
    expect(applied).toBe(events.length);

    const source = createdEvents[0];
    expect(source).toBeDefined();
    if (!source) return;

    const vaultId = Number(source.payload.vault_id);
    const totalAmount = BigInt(String(source.payload.total_amount));
    const milestones = Number(source.payload.milestones);

    const vault = await prisma.vault.findUnique({
      where: { id: vaultId },
      include: { milestonesRef: true },
    });
    expect(vault).not.toBeNull();
    if (!vault) return;

    expect(vault.id).toBe(vaultId);
    expect(vault.totalAmount).toBe(totalAmount.toString());
    expect(vault.amountPerMilestone).toBe((totalAmount / BigInt(milestones)).toString());
    expect(vault.milestones).toBe(milestones);
    expect(vault.milestonesReleased).toBe(releasesFor(vaultId).length);
    expect(vault.status).toBe("Active");
    expect(vault.funder).toBe(String(source.payload.funder));
    expect(vault.createdTxHash).toBe(source.txHash);
    expect(vault.createdTxHash).toMatch(/^[0-9a-f]{64}$/);

    // Unlock times must match the contract's schedule exactly:
    // `start_time + duration * (i + 1) / milestones`, with integer division.
    const start = Number(vault.startTime);
    const schedule = [...vault.milestonesRef]
      .sort((a, b) => a.index - b.index)
      .map((milestone) => Number(milestone.unlockTime));
    expect(schedule).toEqual(
      Array.from(
        { length: milestones },
        (_value, index) => start + Math.floor((vault.duration * (index + 1)) / milestones),
      ),
    );
    expect(Number(vault.clawbackTime)).toBe(start + vault.duration + 14 * 24 * 60 * 60);
  });

  it("indexes every vault the fixture contains", async () => {
    await seedEvents(prisma, events);

    const vaults = await prisma.vault.findMany({ orderBy: { id: "asc" } });

    expect(vaults).toHaveLength(createdEvents.length);
    expect(vaults.map((vault) => vault.id)).toEqual(
      createdEvents.map((event) => Number(event.payload.vault_id)).sort((a, b) => a - b),
    );

    for (const event of createdEvents) {
      const vault = vaults.find((candidate) => candidate.id === Number(event.payload.vault_id));
      const total = BigInt(String(event.payload.total_amount));
      const milestones = BigInt(Number(event.payload.milestones));

      expect(vault?.milestones).toBe(Number(event.payload.milestones));
      expect(vault?.totalAmount).toBe(total.toString());
      expect(vault?.amountPerMilestone).toBe((total / milestones).toString());
    }
  });

  it("is idempotent: replaying the same events changes nothing", async () => {
    await seedEvents(prisma, events);
    const before = {
      vaults: await prisma.vault.count(),
      milestones: await prisma.milestone.count(),
      events: await prisma.vaultEvent.count(),
      released: await prisma.vault.count({ where: { milestonesReleased: { gt: 0 } } }),
    };

    const replayed = await seedEvents(prisma, events);
    expect(replayed).toBe(0);

    expect(await prisma.vault.count()).toBe(before.vaults);
    expect(await prisma.milestone.count()).toBe(before.milestones);
    expect(await prisma.vaultEvent.count()).toBe(before.events);
    expect(await prisma.vault.count({ where: { milestonesReleased: { gt: 0 } } })).toBe(
      before.released,
    );
  });

  it("folds releases into milestone rows and vault totals", async () => {
    await seedEvents(prisma, events);

    const releases = events.filter((event) => event.topic === "milestone_released");
    expect(releases.length).toBeGreaterThan(0);

    for (const release of releases) {
      const vaultId = Number(release.payload.vault_id);
      const index = Number(release.payload.milestone_index);

      const milestone = await prisma.milestone.findUnique({
        where: { vaultId_index: { vaultId, index } },
      });
      expect(milestone?.released).toBe(true);
      expect(milestone?.releaseTxHash).toBe(release.txHash);
      expect(milestone?.releaseLedger).toBe(release.ledger);
    }

    const target = releases[0];
    expect(target).toBeDefined();
    if (!target) return;

    const vaultId = Number(target.payload.vault_id);
    const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
    const expectedReleased = vault?.milestonesReleased ?? 0;

    expect(vault?.milestonesReleased).toBe(releasesFor(vaultId).length);
    expect(vault?.amountReleased).toBe(
      releasesFor(vaultId)
        .reduce((sum, event) => sum + BigInt(String(event.payload.amount)), 0n)
        .toString(),
    );
    // A vault only completes once every milestone in its schedule is released.
    expect(vault?.status).toBe(
      vault && expectedReleased >= vault.milestones ? "Completed" : "Active",
    );
  });

  it("records raw events even when the vault is unknown", async () => {
    const orphan: DecodedEvent = {
      eventId: "999-orphan-0",
      topic: "milestone_released",
      specName: "MilestoneReleased",
      ledger: 999,
      txHash: "f".repeat(64),
      contractId: "C".padEnd(56, "A"),
      occurredAt: 1_700_000_000,
      payload: {
        vault_id: 4242n,
        milestone_index: 0n,
        recipient: "G".padEnd(56, "A"),
        amount: 1n,
        released_at: 1_700_000_000n,
      },
    };

    const applied = await applyDecodedEvent(prisma, orphan);
    expect(applied).toBe(true);

    const stored = await prisma.vaultEvent.findUnique({ where: { eventId: orphan.eventId } });
    expect(stored?.vaultId).toBe(4242);
    expect(await prisma.vault.count()).toBe(0);
  });

  it("serialises bigint payloads as strings in the event log", async () => {
    await seedEvents(prisma, events);

    const stored = await prisma.vaultEvent.findFirst({
      where: { topic: "vault_created" },
      orderBy: { ledger: "asc" },
    });
    expect(stored).not.toBeNull();

    const source = createdEvents[0];
    expect(source).toBeDefined();
    if (!source) return;

    const payload = JSON.parse(stored?.payload ?? "{}") as Record<string, unknown>;
    expect(payload.total_amount).toBe(String(source.payload.total_amount));
    expect(typeof payload.total_amount).toBe("string");
    expect(payload.milestones).toBe(Number(source.payload.milestones));
    expect(String(payload.vault_id)).toBe(String(source.payload.vault_id));
  });
});
