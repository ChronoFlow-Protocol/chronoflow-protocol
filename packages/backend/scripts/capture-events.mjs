#!/usr/bin/env node
/**
 * Captures real Soroban events for the deployed contract into
 * `test/fixtures/<network>-events.json`.
 *
 * The decoder and indexer tests run against this fixture, so they exercise the
 * exact wire format the RPC returns instead of hand-written mocks.
 *
 *   node scripts/capture-events.mjs [network]     # default: testnet
 *
 * The fixture is committed; regenerate it after changing the contract.
 *
 * Scanning starts at the ledger recorded by the deploy script rather than the
 * oldest ledger the RPC still retains: the RPC returns no events at all when
 * the requested window reaches back before its event retention.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rpc } from "@stellar/stellar-sdk";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(SCRIPT_DIR, "..");
const REGISTRY_FILE = join(BACKEND_DIR, "..", "contracts", "deployments", "registry.json");
const FIXTURES_DIR = join(BACKEND_DIR, "test", "fixtures");

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

const network = process.argv[2] ?? "testnet";
const registry = JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
const deployment = registry[network];

if (!deployment?.contractId) {
  process.stderr.write(
    `no contract id recorded for '${network}'.\n` +
      "Deploy first: pnpm --filter @chronoflow/contracts run deploy:testnet\n",
  );
  process.exit(1);
}

const server = new rpc.Server(deployment.rpcUrl, {
  allowHttp: deployment.rpcUrl.startsWith("http://"),
});
const filters = [{ type: "contract", contractIds: [deployment.contractId] }];

const health = await server.getHealth();
const latestLedger = Number(health.latestLedger ?? 0);
const oldestLedger = Number(health.oldestLedger ?? Math.max(latestLedger - 10_000, 1));
const deployedLedger = Number(deployment.deployedLedger ?? 0);
const requestedStart = deployedLedger > 0 ? deployedLedger : latestLedger - 10_000;
const startLedger = Math.max(requestedStart, oldestLedger);

const events = [];
let cursor = "";

for (let page = 0; page < MAX_PAGES; page += 1) {
  const response = await server.getEvents(
    cursor ? { filters, cursor, limit: PAGE_SIZE } : { filters, startLedger, limit: PAGE_SIZE },
  );

  const batch = response.events ?? [];
  events.push(...batch);
  cursor = response.cursor ?? "";

  if (batch.length < PAGE_SIZE || !cursor) break;
}

const serialized = events.map((event) => ({
  id: event.id,
  ledger: event.ledger,
  txHash: event.txHash,
  contractId:
    typeof event.contractId === "string" ? event.contractId : String(event.contractId ?? ""),
  ledgerClosedAt: event.ledgerClosedAt,
  inSuccessfulContractCall: event.inSuccessfulContractCall,
  topic: event.topic.map((topic) => topic.toXDR("base64")),
  value: event.value.toXDR("base64"),
}));

const fixture = {
  network,
  contractId: deployment.contractId,
  rpcUrl: deployment.rpcUrl,
  capturedAt: new Date().toISOString(),
  deployedLedger: deployedLedger || null,
  startLedger,
  latestLedger,
  events: serialized,
};

mkdirSync(FIXTURES_DIR, { recursive: true });
const outputFile = join(FIXTURES_DIR, `${network}-events.json`);
writeFileSync(outputFile, `${JSON.stringify(fixture, null, 2)}\n`);

process.stdout.write(
  `captured ${serialized.length} event(s) from ${deployment.contractId}\n` +
    `  scanned ledgers ${startLedger}..${latestLedger}\n` +
    `  written to ${outputFile}\n`,
);
