import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { IndexerSnapshot } from "../src/indexer/indexer.js";
import { createLogger } from "../src/lib/logger.js";
import { formatUnits } from "../src/lib/values.js";
import type { VaultView } from "../src/services/vaultService.js";
import type { StatsView } from "../src/services/statsService.js";
import { createTestPrisma, resetDatabase, seedEvents } from "./helpers/db.js";
import { loadDecodedEvents } from "./helpers/fixture.js";

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

const CONTRACT_ID = `C${"A".repeat(55)}`;
const DECIMALS = 7;

/** Expectations derived from the captured fixture rather than hard-coded. */
const fixtureEvents = loadDecodedEvents();
const createdEvents = fixtureEvents.filter((event) => event.topic === "vault_created");
const fixtureIds = createdEvents
  .map((event) => Number(event.payload.vault_id))
  .sort((a, b) => a - b);
const latestId = fixtureIds[fixtureIds.length - 1] ?? 0;
const latest = createdEvents.find((event) => Number(event.payload.vault_id) === latestId);
if (!latest) throw new Error("fixture contains no vault_created event");

const milestoneCount = (event: (typeof createdEvents)[number]) => Number(event.payload.milestones);
const escrowedTotal = createdEvents.reduce(
  (sum, event) => sum + BigInt(String(event.payload.total_amount)),
  0n,
);
const uniqueFunders = new Set(createdEvents.map((event) => String(event.payload.funder))).size;
const uniqueTokens = new Set(createdEvents.map((event) => String(event.payload.token))).size;

describe("REST API", () => {
  let prisma: PrismaClient;
  let server: Server;
  let baseUrl: string;

  const snapshot: IndexerSnapshot = {
    running: true,
    network: "testnet",
    contractId: CONTRACT_ID,
    rpcUrl: "https://example.invalid",
    lastLedger: 1_234,
    latestLedger: 1_240,
    lastPollAt: "2026-01-01T00:00:00.000Z",
    lastError: null,
    eventsIngested: 5,
    eventsScanned: 5,
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await seedEvents(prisma, loadDecodedEvents());

    const app = createApp({
      prisma,
      config: loadConfig({
        ...process.env,
        DATABASE_URL: "file:./test.db",
        CONTRACT_ID,
        LOG_LEVEL: "silent",
        INDEXER_ENABLED: "false",
      }),
      logger: createLogger("silent"),
      indexer: { snapshot: () => snapshot },
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
  });

  it("describes itself at the root", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      contract: string;
      contractId: string;
      endpoints: string[];
    };
    expect(body.contract).toBe("chronoflow-escrow");
    expect(body.contractId).toBe(CONTRACT_ID);
    expect(body.endpoints).toContain("GET /api/vaults");
  });

  it("lists vaults newest first, with timelines and display amounts", async () => {
    const response = await fetch(`${baseUrl}/api/vaults`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Envelope<VaultView[]>;
    expect(body.data).toHaveLength(createdEvents.length);
    expect(body.meta?.total).toBe(createdEvents.length);

    const [newest] = body.data;
    expect(newest?.id).toBe(latestId);
    expect(newest?.status).toBe("Active");
    expect(newest?.timeline).toHaveLength(milestoneCount(latest));
    expect(newest?.totalAmount).toBe(String(latest.payload.total_amount));
    expect(newest?.totalAmountDisplay).toBe(
      formatUnits(BigInt(String(latest.payload.total_amount)), DECIMALS),
    );
    expect(newest?.timeline.map((milestone) => milestone.index)).toEqual(
      Array.from({ length: milestoneCount(latest) }, (_value, index) => index),
    );

    // Milestone states are computed against the current time, so assert the
    // invariant rather than a snapshot of the clock.
    for (const milestone of newest?.timeline ?? []) {
      if (milestone.released) {
        expect(milestone.state).toBe("released");
      } else {
        expect(["locked", "releasable"]).toContain(milestone.state);
      }
    }
  });

  it("filters by status, participant and token", async () => {
    const all = (await (await fetch(`${baseUrl}/api/vaults`)).json()) as Envelope<VaultView[]>;
    const recipient = all.data[0]?.recipient ?? "";
    const token = all.data[0]?.token ?? "";

    const byRecipient = (await (
      await fetch(`${baseUrl}/api/vaults?recipient=${recipient}`)
    ).json()) as Envelope<VaultView[]>;
    expect(byRecipient.data.length).toBeGreaterThan(0);
    expect(byRecipient.data.every((vault) => vault.recipient === recipient)).toBe(true);

    const byToken = (await (
      await fetch(`${baseUrl}/api/vaults?token=${token}`)
    ).json()) as Envelope<VaultView[]>;
    expect(byToken.data).toHaveLength(all.data.length);

    const clawedBack = (await (
      await fetch(`${baseUrl}/api/vaults?status=ClawedBack`)
    ).json()) as Envelope<VaultView[]>;
    expect(clawedBack.data).toHaveLength(0);

    const active = (await (
      await fetch(`${baseUrl}/api/vaults?status=Active&limit=1&offset=1`)
    ).json()) as Envelope<VaultView[]>;
    expect(active.data).toHaveLength(1);
  });

  it("returns a single vault with its milestone timeline and event log", async () => {
    const target = createdEvents[0] ?? latest;
    const targetId = Number(target.payload.vault_id);
    const milestones = milestoneCount(target);

    const response = await fetch(`${baseUrl}/api/vaults/${targetId}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Envelope<VaultView>;
    const vault = body.data;

    expect(vault.id).toBe(targetId);
    expect(vault.milestones).toBe(milestones);
    expect(vault.timeline.map((milestone) => milestone.index)).toEqual(
      Array.from({ length: milestones }, (_value, index) => index),
    );
    expect(vault.progress).toBeGreaterThanOrEqual(0);
    expect(vault.progress).toBeLessThanOrEqual(100);
    expect(vault.endTime).toBe(vault.startTime + Number(target.payload.duration));
    expect(vault.clawbackTime).toBe(vault.endTime + 14 * 24 * 60 * 60);

    // The release that the fixture contains is folded into both views.
    const released = vault.timeline.filter((milestone) => milestone.released);
    expect(released.length).toBe(vault.milestonesReleased);
    expect(BigInt(vault.amountReleased)).toBe(
      released.reduce((sum, milestone) => sum + BigInt(milestone.amount), 0n),
    );
    expect(BigInt(vault.amountRemaining)).toBe(
      BigInt(vault.totalAmount) - BigInt(vault.amountReleased),
    );

    expect(vault.events?.length).toBeGreaterThan(0);
    expect(vault.events?.some((event) => event.kind === "VaultCreated")).toBe(true);
  });

  it("404s for a vault that is not indexed", async () => {
    const response = await fetch(`${baseUrl}/api/vaults/9999`);
    expect(response.status).toBe(404);

    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("9999");
  });

  it("400s for invalid query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/vaults?limit=1000`);
    expect(response.status).toBe(400);

    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain("query");
  });

  it("aggregates protocol stats", async () => {
    const response = await fetch(`${baseUrl}/api/stats`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Envelope<StatsView>;
    const stats = body.data;

    expect(stats.contractId).toBe(CONTRACT_ID);
    expect(stats.network).toBe("testnet");
    // The fixture releases only part of each schedule, so every vault is active.
    expect(stats.totals.vaults).toBe(createdEvents.length);
    expect(stats.totals.activeVaults).toBe(createdEvents.length);
    expect(stats.totals.clawedBackVaults).toBe(0);
    expect(stats.totals.milestones).toBe(
      createdEvents.reduce((sum, event) => sum + milestoneCount(event), 0),
    );
    expect(stats.totals.uniqueFunders).toBe(uniqueFunders);
    expect(stats.totals.uniqueTokens).toBe(uniqueTokens);

    expect(stats.amounts.escrowed).toBe(escrowedTotal.toString());
    expect(stats.amounts.escrowedDisplay).toBe(formatUnits(escrowedTotal, DECIMALS));
    expect(BigInt(stats.amounts.released) + BigInt(stats.amounts.locked)).toBe(escrowedTotal);
    expect(stats.tokens).toHaveLength(uniqueTokens);
    expect(stats.indexer.lastLedger).toBe(1_234);
  });

  it("reports indexer health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      indexer: { running: boolean; lastLedger: number };
    };
    expect(body.status).toBe("ok");
    expect(body.indexer.running).toBe(true);
    expect(body.indexer.lastLedger).toBe(1_234);
  });

  it("uses an error envelope for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);

    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("/api/does-not-exist");
  });
});
