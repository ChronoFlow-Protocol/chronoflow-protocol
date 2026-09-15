# Architecture

```
┌──────────────┐   create_vault / release_milestone / clawback   ┌────────────────────────┐
│  dApp (Next) │ ─────────────────────────────────────────────▶ │ chronoflow_escrow      │
│  Freighter   │ ◀──── simulate (get_vault, unlock_time) ─────── │ (Soroban, Stellar)     │
└──────┬───────┘                                                └───────────┬────────────┘
       │ GET /api/vaults, /api/stats                                        │ events
       ▼                                                                    ▼
┌──────────────────────┐   poll getEvents from the deploy ledger   ┌────────────────────┐
│ Indexer API (Node)   │ ◀──────────────────────────────────────── │ Soroban RPC        │
│ Express + Prisma     │                                            └────────────────────┘
└──────────────────────┘
```

Three processes, one shared source of truth: `src/generated/chronoflow.ts`, produced by
`packages/contracts/scripts/export-artifacts.mjs` from the compiled wasm spec.

---

## 1. The contract

`packages/contracts/contracts/chronoflow-escrow/src/lib.rs`.

### State

| Key             | Storage    | Contents                                                         |
| --------------- | ---------- | ---------------------------------------------------------------- |
| `Admin`         | instance   | address allowed to pause and retune the clawback delay           |
| `ClawbackDelay` | instance   | seconds added to each vault's duration before clawback           |
| `Paused`        | instance   | blocks `create_vault` and `release_milestone` (never `clawback`) |
| `NextVaultId`   | instance   | monotonically increasing id source                               |
| `Vault(id)`     | persistent | the full vault record                                            |

`Vault` fields: `id`, `funder`, `recipient`, `token`, `total_amount`, `amount_per_milestone`,
`amount_released`, `milestones`, `milestones_released`, `start_time`, `duration`, `clawback_time`,
`status` (`Active` → `Completed` | `ClawedBack`).

`#[contracttype]` structs keep named fields on the wire, so the indexer decodes maps rather than
positional tuples — this is what makes the generated TypeScript readable (`payload.total_amount`
instead of `payload[4]`).

### Lifecycle

```
create_vault ──▶ Active ──release_milestone × n──▶ Completed
                   │
                   └──clawback (after clawback_time)──▶ ClawedBack
```

Invariants enforced on-chain:

1. `duration > 0`, `1 ≤ milestones ≤ MAX_MILESTONES (100)`, `amount > 0` and `amount % milestones == 0`.
2. A milestone unlocks at `start_time + duration × (i + 1) ÷ milestones` (integer division).
3. Releases happen strictly in index order; there is no way to skip ahead or replay one.
4. The funder must sign `create_vault` and `clawback`; `release_milestone` is permissionless but
   always pays the _stored_ recipient, never the caller.
5. State is written before the token transfer (checks-effects-interactions), and a vault can only
   leave `Active` once.
6. `clawback` ignores `Paused`, so a funder can always recover expired capital.

### Events

| Topic (symbol)           | Rust type              | Payload                                                                                                             |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `vault_created`          | `VaultCreated`         | `vault_id`, `funder`, `recipient`, `token`, `total_amount`, `milestones`, `start_time`, `duration`, `clawback_time` |
| `milestone_released`     | `MilestoneReleased`    | `vault_id`, `milestone_index`, `recipient`, `amount`, `released_at`                                                 |
| `vault_completed`        | `VaultCompleted`       | `vault_id`, `total_released`, `completed_at`                                                                        |
| `vault_clawed_back`      | `VaultClawedBack`      | `vault_id`, `funder`, `amount`, `clawed_back_at`                                                                    |
| `clawback_delay_updated` | `ClawbackDelayUpdated` | `old_delay`, `new_delay`                                                                                            |
| `contract_pause_toggled` | `ContractPauseToggled` | `paused`                                                                                                            |

Topic symbols come from the spec's prefix topics (via `#[contractevent]`, which snake-cases the Rust
name — `MilestoneReleased` → `milestone_released`), so the exporter reads them from the artifact
rather than guessing. `src/test.rs` asserts those symbols so a rename can never silently break the
indexer.

### Errors

`NotInitialized`(1) · `InvalidDuration`(2) · `InvalidMilestoneCount`(3) · `InvalidAmount`(4) ·
`VaultNotFound`(5) · `VaultNotActive`(6) · `MilestoneLocked`(7) · `NoMilestonesRemaining`(8) ·
`ClawbackTooEarly`(9) · `ContractPaused`(10) · `MilestoneIndexOutOfBounds`(11)

The frontend maps each of these codes to actionable copy (`describeSorobanError`), so a rejected
simulation surfaces as "The next milestone has not unlocked yet — wait for its unlock time."

---

## 2. The indexer API

`packages/backend`.

### Ingestion

```
pollOnce()                                     every INDEXER_POLL_INTERVAL_MS
  ├─ getHealth()            → latestLedger, oldestLedger
  ├─ nextStartLedger()      → stored cursor + 1, else INDEXER_START_LEDGER (deploy ledger)
  ├─ getEvents({ startLedger, filters: [{ type: "contract", contractIds: [id] }], limit })
  ├─ toRawEvent(event)      → drops failed invocations, normalises the Contract id
  ├─ decodeEvent(raw)       → spec lookup, scValToNative on topic + data fields
  └─ applyDecodedEvent()    → one Prisma transaction per event
```

Notes that matter in production:

- The filter is **contract-wide, not topic-filtered**. The RPC treats topic segments positionally
  (max 4 per filter, max 5 filters per request), so covering six event symbols would need two round
  trips; the decoder already ignores topics it does not track, and keeping admin events in the log is
  useful.
- `getEvents` returns _nothing_ when `startLedger` reaches back before its event retention, which is
  why the indexer starts at the deployment ledger recorded by the deploy script.
- Every row is written under a unique `eventId` (`<ledger>-<tx>-<event index>`), making replays,
  re-orgs and overlapping polls idempotent. `VaultEvent.vaultId` is deliberately **not** a foreign
  key: an event for a vault whose creation predates the cursor must still be logged rather than
  wedging the poller.

### Projections

- `vault_created` → upsert `Vault` + one `Milestone` row per slice (with its `unlockTime`).
- `milestone_released` → mark the milestone released, add to `Vault.amountReleased` and
  `milestonesReleased`; flip to `Completed` when the schedule is exhausted.
- `vault_clawed_back` → `ClawedBack`, record the returned amount.
- admin events → logged only.

### Endpoints

| Method | Path              | Returns                                                                                                                   |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/`               | service metadata (`contract`, `contractId`, `endpoints`)                                                                  |
| `GET`  | `/health`         | `{ status, uptimeSeconds, network, contractId, indexer }` (503 when the indexer has never polled and is enabled)          |
| `GET`  | `/api/vaults`     | envelope of `VaultView` — filters `status`, `funder`, `recipient`, `token`; paging `limit` (≤100), `offset`; newest first |
| `GET`  | `/api/vaults/:id` | one `VaultView` including its milestone timeline and event log                                                            |
| `GET`  | `/api/stats`      | protocol totals, amount buckets, per-token breakdown, indexer snapshot                                                    |

`VaultView` carries raw base-unit strings _and_ display strings, plus a derived timeline where each
milestone has `state ∈ {locked, releasable, released, cancelled}`. All errors share one envelope:

```json
{ "error": { "code": "NOT_FOUND", "message": "No vault with id 42." } }
```

### Data model

`Vault` (current state) ← `Milestone` (per-slice progress, unique on `(vaultId, index)`), with
`VaultEvent` as the append-only log and `IndexerCursor` as the resume point. Amounts are stored as
decimal strings so `i128` values survive SQLite; timestamps use `BigInt` epoch seconds to match the
ledger clock. Swap SQLite for Postgres with `pnpm --filter @chronoflow/backend run db:use-postgres`.

---

## 3. The dApp

`packages/frontend` — Next.js 14 App Router, Tailwind, `@stellar/stellar-sdk`, `@stellar/freighter-api`.

### Read paths

- **Indexer API** (`src/lib/api.ts`) for lists, timelines, aggregates — polled every 12s with a
  manual refresh after every confirmed write.
- **Direct contract simulation** (`src/lib/soroban.ts`) for `get_vault`, `vault_count` and
  `unlock_time`, so the UI can show live contract state even when the indexer is unavailable.

### Write path

```
validate (src/lib/validation.ts)               mirrors the contract's checks
  └─ TransactionBuilder → Contract.call(method, …args)
       └─ server.prepareTransaction(tx)        simulate + assemble footprint & auth
            └─ Freighter signTransaction(xdr)  signs the envelope and the funder auth entry
                 └─ server.sendTransaction()   → poll getTransaction until SUCCESS/FAILED
                      └─ explorer link + refetch
```

Simulation failures are decoded through the generated error map, so users see "The amount must split
evenly across 3 milestones" rather than a raw host error.

### Time

`useNow()` ticks every second. Unlock states, countdowns and locked/unlocked/released buckets are all
computed client-side from `start_time`, `duration` and `milestones` — the same formula the contract
uses — so the timeline stays live between indexer polls.

### Components

`WalletProvider` (Freighter connect / silent reconnect / network check / signing) ·
`CreateVaultForm` (validation + schedule preview) · `VaultList` (status filters, error states) ·
`VaultCard` · `MilestoneTimeline` (segmented locked/unlocked/released bar + per-milestone states) ·
`VaultActions` (Release Milestone / Claim Payout / Clawback Escrow, disabled with countdowns when
ineligible) · `StatsGrid`.

---

## Testing

| Suite                    | Scope                                                                                                                                                    | Count |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `cargo test` (contracts) | vault creation validation, schedule maths, per-milestone release, clawback rules, pausing, admin auth, event topic symbols, storage keys, boundary cases | 36    |
| `vitest` (backend)       | scVal decoding, rest API envelopes, indexer projections (idempotency, orphan events, bigint serialisation) against a **captured testnet fixture**        | 34    |
| `vitest` (frontend)      | amount parsing/formatting, milestone scheduling, form validation, contract-error translation                                                             | 38    |

The backend fixture is real: `scripts/capture-events.mjs` pulls events for the deployed contract from
the testnet RPC into `test/fixtures/testnet-events.json`, so decoding is tested against the exact wire
format rather than hand-written mocks. Re-record it after redeploying the contract.
