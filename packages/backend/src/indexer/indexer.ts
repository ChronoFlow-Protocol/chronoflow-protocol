import type { PrismaClient } from "@prisma/client";
import type { rpc } from "@stellar/stellar-sdk";

import type { AppConfig } from "../config.js";
import { describeError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { createEventFilter, createRpcServer } from "../lib/stellar.js";
import { decodeEvent, toRawEvent } from "./decode.js";
import { applyDecodedEvent } from "./handlers.js";

/** Safety valve so one poll cannot loop forever on a huge backlog. */
const MAX_PAGES_PER_POLL = 20;

export interface IndexerSnapshot {
  running: boolean;
  network: string;
  contractId: string;
  rpcUrl: string;
  /** Highest ledger fully scanned. */
  lastLedger: number;
  /** Tip reported by the RPC on the last poll. */
  latestLedger: number;
  lastPollAt: string | null;
  lastError: string | null;
  /** Events folded into the database since boot. */
  eventsIngested: number;
  /** Contract events decoded (including replays) since boot. */
  eventsScanned: number;
}

export interface IndexerStatusProvider {
  snapshot(): IndexerSnapshot;
}

export interface IndexerDeps {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
}

/**
 * Polls Soroban RPC for ChronoFlow events and folds them into the database.
 *
 * The poller is idempotent: the cursor records the highest fully scanned
 * ledger, and each event is applied inside a transaction guarded by a unique
 * event id. Restarting, or scanning an overlapping range, cannot double-count.
 */
export class EventIndexer implements IndexerStatusProvider {
  private readonly server: rpc.Server;
  private readonly filter;
  private readonly prisma: PrismaClient;
  private readonly config: AppConfig;
  private readonly logger: Logger;

  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private running = false;
  private lastLedger = 0;
  private latestLedger = 0;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;
  private eventsIngested = 0;
  private eventsScanned = 0;

  constructor(deps: IndexerDeps) {
    this.prisma = deps.prisma;
    this.config = deps.config;
    this.logger = deps.logger.child("indexer");
    this.server = createRpcServer(deps.config.rpcUrl);
    this.filter = createEventFilter(deps.config.contractId);
  }

  /** Runs one poll immediately, then schedules them at the configured interval. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.persistedCursor();
    await this.pollOnce();

    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.config.indexer.pollIntervalMs);
    // Do not keep the event loop alive just for polling.
    this.timer.unref?.();

    this.logger.info("started", {
      contractId: this.config.contractId,
      network: this.config.stellarNetwork,
      pollIntervalMs: this.config.indexer.pollIntervalMs,
      lastLedger: this.lastLedger,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info("stopped", { lastLedger: this.lastLedger });
  }

  snapshot(): IndexerSnapshot {
    return {
      running: this.running,
      network: this.config.stellarNetwork,
      contractId: this.config.contractId,
      rpcUrl: this.config.rpcUrl,
      lastLedger: this.lastLedger,
      latestLedger: this.latestLedger,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      eventsIngested: this.eventsIngested,
      eventsScanned: this.eventsScanned,
    };
  }

  /**
   * Fetches every event since the cursor and applies it. Exposed so tests and
   * operational tooling can drive a single pass.
   */
  async pollOnce(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const health = await this.server.getHealth();
      const latestLedger = Number(health.latestLedger ?? 0);
      const oldestLedger = Number(
        (health as { oldestLedger?: number }).oldestLedger ?? Math.max(latestLedger - 1, 1),
      );
      this.latestLedger = latestLedger;

      const startLedger = await this.nextStartLedger(oldestLedger);
      if (startLedger > latestLedger) {
        this.lastError = null;
        return;
      }

      await this.ingestFrom(startLedger);
      this.lastError = null;
    } catch (error) {
      this.lastError = describeError(error);
      this.logger.warn("poll failed", { error: this.lastError });
    } finally {
      this.inFlight = false;
      this.lastPollAt = new Date().toISOString();
    }
  }

  private async ingestFrom(fromLedger: number): Promise<void> {
    const pageSize = this.config.indexer.pageSize;
    let startLedger = fromLedger;
    let scannedThrough = fromLedger - 1;

    for (let page = 0; page < MAX_PAGES_PER_POLL; page += 1) {
      const response = await this.server.getEvents({
        startLedger,
        filters: [this.filter],
        limit: pageSize,
      });

      const events = response.events ?? [];
      this.latestLedger = Number(response.latestLedger ?? this.latestLedger);

      let lastLedgerInPage = scannedThrough;
      for (const rawEvent of events) {
        const normalized = toRawEvent(rawEvent);
        if (!normalized) continue;

        this.eventsScanned += 1;
        lastLedgerInPage = Math.max(lastLedgerInPage, normalized.ledger);

        const decoded = decodeEvent(normalized);
        if (!decoded) continue;

        const applied = await applyDecodedEvent(this.prisma, decoded);
        if (applied) {
          this.eventsIngested += 1;
          this.logger.debug("indexed event", {
            topic: decoded.topic,
            ledger: decoded.ledger,
            eventId: decoded.eventId,
          });
        }
      }

      if (events.length === 0) {
        scannedThrough = Math.max(scannedThrough, this.latestLedger);
        break;
      }

      scannedThrough = Math.max(scannedThrough, lastLedgerInPage);

      if (events.length < pageSize) {
        scannedThrough = Math.max(scannedThrough, this.latestLedger);
        break;
      }

      startLedger = lastLedgerInPage + 1;
      if (startLedger > this.latestLedger) break;
    }

    if (scannedThrough >= this.lastLedger) {
      this.lastLedger = scannedThrough;
      await this.saveCursor(scannedThrough);
    }
  }

  private async nextStartLedger(oldestLedger: number): Promise<number> {
    const cursor = await this.persistedCursor();

    if (cursor !== null) {
      return Math.max(cursor + 1, oldestLedger);
    }

    const configured = this.config.indexer.startLedger;
    if (configured !== undefined) {
      return Math.max(configured, oldestLedger);
    }

    this.logger.info("no indexer cursor yet; scanning the RPC retention window", {
      oldestLedger,
    });
    return oldestLedger;
  }

  private async persistedCursor(): Promise<number | null> {
    const cursor = await this.prisma.indexerCursor.findUnique({
      where: { contractId: this.config.contractId },
      select: { lastLedger: true },
    });

    if (!cursor) return null;
    this.lastLedger = Math.max(this.lastLedger, cursor.lastLedger);
    return cursor.lastLedger;
  }

  private async saveCursor(lastLedger: number): Promise<void> {
    const contractId = this.config.contractId;
    await this.prisma.indexerCursor.upsert({
      where: { contractId },
      create: { contractId, lastLedger },
      update: { lastLedger },
    });
  }
}
