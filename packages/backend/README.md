# `@chronoflow/backend`

The ChronoFlow indexer and REST API: it listens to Soroban RPC events from the deployed escrow
contract, folds them into a database, and serves vault timelines, payout progress and protocol
aggregates to the dApp.

```
src/
├── indexer/
│   ├── indexer.ts    poller: cursor → getEvents → decode → apply (idempotent)
│   ├── decode.ts     SDK event → RawSorobanEvent → spec-decoded payload
│   └── handlers.ts   event → Prisma projections (vault, milestones, event log)
├── services/         vaultService (views + timeline), statsService (aggregates)
├── routes/           /, /health, /api/vaults, /api/vaults/:id, /api/stats
├── lib/              config (zod), logger, prisma, stellar, values, errors
└── generated/       chronoflow.ts — contract spec written by the deploy script
```

## Quickstart

```bash
cp .env.example .env                 # optional: every value has a default
pnpm --filter @chronoflow/backend run db:generate
pnpm --filter @chronoflow/backend run db:push
pnpm --filter @chronoflow/backend run dev      # http://localhost:4000
```

```bash
curl localhost:4000/health
curl "localhost:4000/api/vaults?limit=5"
curl localhost:4000/api/vaults/1
curl localhost:4000/api/stats
```

## Endpoints

| Method | Path              | Notes                                                                                                                                |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/`               | service metadata and endpoint list                                                                                                   |
| `GET`  | `/health`         | liveness + indexer snapshot; `503` if the indexer is enabled but has never polled                                                    |
| `GET`  | `/api/vaults`     | filters: `status` (`Active`/`Completed`/`ClawedBack`), `funder`, `recipient`, `token`; paging: `limit` ≤ 100, `offset`; newest first |
| `GET`  | `/api/vaults/:id` | one vault with its milestone timeline and event log; `404` when unknown                                                              |
| `GET`  | `/api/stats`      | totals, amount buckets (escrowed/released/locked/streamed), per-token breakdown, indexer snapshot                                    |

Responses use a single envelope — `{ "data": …, "meta": { "total", "limit", "offset", "decimals" } }`
for lists, `{ "error": { "code", "message", "details?" } }` for failures. Amounts are returned both as
base-unit strings (exact `i128`) and as display strings.

## Configuration

Everything is validated by zod at boot (`src/config.ts`); a bad value fails fast with a list of the
offending variables. See [`.env.example`](.env.example) for the full set. The Stellar network, RPC url
and contract id default to whatever the contract deploy script exported, so a fresh clone is
correctly wired without a `.env`.

## Database

SQLite is the default so a clone runs with zero infrastructure; `pnpm db:use-postgres` swaps in
`schema.postgres.prisma` for production. Models:

| Model           | Purpose                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Vault`         | current folded state (amounts as decimal strings, timestamps as `BigInt` epoch seconds)                                                                                                                    |
| `Milestone`     | per-slice progress, unique on `(vaultId, index)`                                                                                                                                                           |
| `VaultEvent`    | append-only log of every consumed event, unique on `eventId` (the idempotency key). `vaultId` is intentionally not a foreign key: events for vaults that predate the indexer cursor must still be recorded |
| `IndexerCursor` | resume point per contract                                                                                                                                                                                  |

## Indexer notes

- It scans forward from the deployment ledger (`deployedLedger` in the generated module, or
  `INDEXER_START_LEDGER`). Pointing it at the RPC's oldest retained ledger yields **zero events** —
  the RPC refuses windows that reach back beyond its retention.
- The event filter is contract-wide rather than topic-filtered: the RPC matches topic segments
  positionally (≤ 4 per filter, ≤ 5 filters per request), so covering every event symbol would take
  two round trips. The decoder drops topics it does not track.
- Ingestion is transactional per event and keyed by `eventId`, so replays, re-orgs, overlapping polls
  and restarts are all safe.
- `VaultEvent.payload` stores the decoded payload with `bigint`s rendered as strings.

## Tests

```bash
pnpm --filter @chronoflow/backend run test        # vitest (34 tests)
pnpm --filter @chronoflow/backend run lint
pnpm --filter @chronoflow/backend run typecheck
pnpm --filter @chronoflow/backend run build
```

`test/global-setup.ts` recreates a throwaway SQLite schema before the suite, so tests never touch
development data. Decoding and projection tests run against `test/fixtures/testnet-events.json` —
**real events** captured from the deployed testnet contract by `scripts/capture-events.mjs`. Re-record
that fixture after redeploying the contract or the decode tests will describe a stale wire format:

```bash
node scripts/capture-events.mjs          # testnet (default), reads contracts/deployments/registry.json
```

## Docker / hosting

`Dockerfile` builds from the repository root (the pnpm workspace is required):

```bash
docker build -f packages/backend/Dockerfile -t chronoflow-api .
docker run --rm -p 8080:8080 -e DATABASE_URL=file:/data/dev.db chronoflow-api
```

`fly.toml` and the root `render.yaml` are ready to use — see
[`docs/deployment.md`](../../docs/deployment.md).
