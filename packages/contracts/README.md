# `@chronoflow/contracts`

The Soroban escrow contract behind ChronoFlow, plus the scripts that build, test, cover, deploy and
export it.

```
contracts/chronoflow-escrow/
├── src/lib.rs      the contract: create_vault, release_milestone, clawback, views, admin
└── src/test.rs     36 unit tests (host-mode), including event-topic and storage-key assertions
scripts/            build · test · coverage · lint · bindings · export · deploy-testnet
deployments/        registry.json + <network>.json (contract id, wasm hash, deploy ledger)
wasm/               compiled artifact (gitignored, produced by build)
bindings/           Stellar CLI TypeScript bindings (gitignored, produced by bindings.sh)
```

## Prerequisites

| Tool        | Version         | Notes                                                            |
| ----------- | --------------- | ---------------------------------------------------------------- |
| Rust        | stable          | `rust-toolchain.toml` pins the toolchain, `clippy` and `rustfmt` |
| wasm target | `wasm32v1-none` | `rustup target add wasm32v1-none`                                |
| Stellar CLI | 28.x            | needed for `contract build`, `deploy` and bindings               |
| Node        | ≥ 22.13         | used by the artifact exporter                                    |

Installing the CLI (Linux x86-64):

```bash
curl -sSL -o /tmp/stellar.tar.gz \
  https://github.com/stellar/stellar-cli/releases/download/v28.0.0/stellar-cli-28.0.0-x86_64-unknown-linux-gnu.tar.gz
tar xzf /tmp/stellar.tar.gz -C /tmp && sudo install /tmp/stellar /usr/local/bin/stellar
stellar --version
```

macOS/arm or Windows: see the [Stellar CLI releases](https://github.com/stellar/stellar-cli/releases).

## API

```rust
create_vault(env, funder, recipient, token, amount, duration, milestones) -> Result<u64, Error>
release_milestone(env, vault_id) -> Result<i128, Error>     // permissionless, pays the recipient
clawback(env, vault_id) -> Result<i128, Error>              // funder-only, after clawback_time

// views
get_vault(vault_id) -> Vault
vault_count() -> u64
vault_milestones(vault_id) -> Vec<MilestoneState>
unlock_time(vault_id, milestone_index) -> u64
releasable_amount(vault_id) -> i128
next_vault_id(), admin(), clawback_delay(), is_paused()

// admin
set_paused(paused), set_clawback_delay(new_delay)
```

Semantics, invariants and the event schema are documented in
[`docs/architecture.md`](../../docs/architecture.md#1-the-contract); the constants that shape user
input are `MAX_MILESTONES = 100` and `DEFAULT_CLAWBACK_DELAY = 14 days`.

## Scripts

```bash
pnpm --filter @chronoflow/contracts run build           # wasm32v1-none release build → wasm/
pnpm --filter @chronoflow/contracts run test            # cargo test (add a filter: test clawback)
pnpm --filter @chronoflow/contracts run test:coverage   # cargo llvm-cov summary (--html for a report)
pnpm --filter @chronoflow/contracts run lint            # rustfmt --check + clippy -D warnings
pnpm --filter @chronoflow/contracts run typecheck       # cargo check --all-targets
pnpm --filter @chronoflow/contracts run bindings        # Stellar CLI TypeScript bindings
pnpm --filter @chronoflow/contracts run export          # regenerate the app config module
pnpm --filter @chronoflow/contracts run deploy:testnet  # build → deploy → export → verify
```

Coverage needs one-time setup: `rustup component add llvm-tools-preview` and
`cargo install cargo-llvm-cov --locked`. Current result: **97.8% regions / 98.1% lines** on
`lib.rs`; CI fails the build below 85% lines.

## Deployment

`deploy:testnet` is idempotent and safe to re-run:

1. builds the wasm,
2. reuses the `chronoflow-deployer` identity or creates and Friendbot-funds it,
3. calls `stellar contract deploy` with the admin and clawback-delay constructor arguments,
4. writes `deployments/registry.json` (contract id, wasm hash, deploy **ledger**, network config),
5. regenerates `packages/{backend,frontend}/src/generated/chronoflow.ts`,
6. generates TypeScript bindings into `bindings/chronoflow-escrow/`,
7. smoke-tests the new contract (`vault_count == 0`).

Environment overrides: `STELLAR_NETWORK`, `STELLAR_SOURCE_ACCOUNT`, `CHRONOFLOW_ADMIN`,
`CHRONOFLOW_CLAWBACK_DELAY`.

Commit `deployments/` and the generated modules after deploying — the app packages build from them.
See [`docs/deployment.md`](../../docs/deployment.md) for the CI workflow and mainnet checklist.

## How the app config is generated

`scripts/export-artifacts.mjs` runs `stellar contract info interface --output json` against the
compiled wasm and renders one TypeScript module consumed by both app packages:

```ts
import {
  CONTRACT_ID,
  METHODS,
  EVENTS,
  ERROR_NAMES,
  DATA_KEY,
  VAULT_STATUS,
  NETWORK,
} from "…/generated/chronoflow";
```

Method specs, event topic symbols (read from the spec's prefix topics), payload field order, error
codes and storage keys all come from the artifact — nothing is hand-maintained, so a contract change
cannot silently drift from the indexer or the UI.
