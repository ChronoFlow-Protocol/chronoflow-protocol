# Deployment guide

Three things get deployed, in this order:

| Piece                            | Where                     | Why first                                 |
| -------------------------------- | ------------------------- | ----------------------------------------- |
| `chronoflow_escrow` contract     | Stellar testnet / mainnet | everything else points at its contract id |
| Indexer API (`packages/backend`) | Render or Fly.io          | serves vault + stats data to the UI       |
| dApp (`packages/frontend`)       | Vercel                    | reads the API, writes to the contract     |

The generated module (`src/generated/chronoflow.ts` in both app packages) is the
contract between them: it carries the contract id, RPC url, network passphrase,
native-asset contract id and the event/error spec. The deploy script rewrites it,
so no app code needs editing to move between deployments.

---

## 1. Deploy the contract to Stellar testnet

### Local (recommended for the first deploy)

```bash
# One-time toolchain setup
rustup target add wasm32v1-none
curl -sSL -o /tmp/stellar.tar.gz \
  https://github.com/stellar/stellar-cli/releases/download/v28.0.0/stellar-cli-28.0.0-x86_64-unknown-linux-gnu.tar.gz
tar xzf /tmp/stellar.tar.gz -C /tmp && sudo install /tmp/stellar /usr/local/bin/stellar

pnpm install
pnpm --filter @chronoflow/contracts run deploy:testnet
```

The script:

1. builds `wasm/chronoflow_escrow.wasm` (`stellar contract build`),
2. creates **and Friendbot-funds** the `chronoflow-deployer` identity if missing,
3. deploys the contract with `--admin` and `--clawback-delay`,
4. records `contractId`, `wasmHash`, `deployedLedger` and the network config in
   `deployments/registry.json` (plus `deployments/<network>.json`),
5. regenerates `packages/{backend,frontend}/src/generated/chronoflow.ts`,
6. generates TypeScript bindings into `bindings/chronoflow-escrow/`,
7. smoke-tests the fresh contract (`vault_count` must be `0`).

Overrides:

```bash
STELLAR_NETWORK=futurenet \
STELLAR_SOURCE_ACCOUNT=my-key \
CHRONOFLOW_ADMIN=G... \
CHRONOFLOW_CLAWBACK_DELAY=604800 \
pnpm --filter @chronoflow/contracts run deploy:testnet
```

Commit `packages/contracts/deployments/` and both `src/generated/chronoflow.ts`
files afterwards — the app packages import them at build time.

### From CI (manual workflow)

`.github/workflows/deploy-contracts.yml` does the same on GitHub runners:

1. Add a repository secret **`STELLAR_SECRET_KEY`** — the `S…` secret key of a
   funded testnet account (create one with `stellar keys generate`, fund it via
   <https://friendbot.stellar.org>).
2. Actions → **Deploy contracts (testnet)** → _Run workflow_.
3. It uploads `deployments/` + the wasm as artifacts, writes the explorer link to
   the run summary, and (optionally) commits the refreshed registry.

### Mainnet

`stellar contract deploy` works unchanged against the public network, but: use a
hardware-backed key, set `CHRONOFLOW_ADMIN` to a multisig account, raise
`CHRONOFLOW_CLAWBACK_DELAY` if you want a longer funder grace period, and export
with `--network mainnet` so the generated config targets the public RPC.

---

## 2. Deploy the indexer API

The API is a long-running Node process with a database and an outbound RPC
connection, so a persistent host is the right fit. Two supported options:

### Render (blueprint included)

`render.yaml` at the repository root defines the web service and a Postgres
instance:

1. Switch the Prisma schema to Postgres and commit it:
   ```bash
   pnpm --filter @chronoflow/backend run db:use-postgres
   git add packages/backend/prisma/schema.prisma && git commit -m "chore(backend): use postgres"
   ```
2. Render → **New → Blueprint** → pick this repository.
3. When prompted, set:
   - `DATABASE_URL` — the instance's **Internal Database URL**
   - `CORS_ORIGIN` — your Vercel domain, e.g. `https://chronoflow.vercel.app`
     (comma-separate multiple origins; `*` is the permissive default)
4. Deploy. Health check: `GET /health` must return `200` with
   `indexer.running: true`.

### Fly.io (config included)

```bash
fly launch --no-deploy --copy-config --name chronoflow-api
fly postgres create --name chronoflow-db
fly postgres attach chronoflow-db --app chronoflow-api   # sets DATABASE_URL
fly secrets set CORS_ORIGIN=https://your-dapp.vercel.app \
                CONTRACT_ID=C... \
                SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
                NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
fly deploy --config packages/backend/fly.toml
```

`fly.toml` runs `db:push` as the release step, keeps one machine always on (so the
event poller never stops), and health-checks `/health` every 30s. Switch
`release_command` to `db:deploy` once you commit Prisma migrations.

### Environment variables

| Variable                   | Default            | Notes                                                  |
| -------------------------- | ------------------ | ------------------------------------------------------ |
| `DATABASE_URL`             | `file:./dev.db`    | SQLite locally, Postgres in production                 |
| `CONTRACT_ID`              | generated          | Contract to index; defaults to the exported deployment |
| `SOROBAN_RPC_URL`          | generated          | Soroban RPC endpoint                                   |
| `NETWORK_PASSPHRASE`       | generated          | Must match the network of `CONTRACT_ID`                |
| `STELLAR_NETWORK`          | generated          | `testnet` / `mainnet`, informational                   |
| `CORS_ORIGIN`              | `*`                | Set to your dApp origin in production                  |
| `INDEXER_ENABLED`          | `true`             | Set `false` to run API-only                            |
| `INDEXER_START_LEDGER`     | deployment ledger  | First ledger to scan                                   |
| `INDEXER_POLL_INTERVAL_MS` | `5000`             | Poll cadence                                           |
| `INDEXER_PAGE_SIZE`        | `200`              | Max events per page (RPC caps at 200)                  |
| `PORT` / `HOST`            | `4000` / `0.0.0.0` | Managed by most hosts                                  |
| `TOKEN_DECIMALS`           | `7`                | Decimals used for display amounts                      |
| `LOG_LEVEL`                | `info`             | `debug` logs every indexed event                       |

> **Note on the start ledger.** `INDEXER_START_LEDGER` defaults to the ledger the
> contract was deployed in. Pointing it at the RPC's oldest retained ledger makes
> `getEvents` return _nothing_, so a fresh deployment must ship with
> `deployedLedger` present in the generated module.

---

## 3. Deploy the dApp to Vercel

1. Vercel → **Add New → Project** → import this repository.
2. Root directory: **repository root** (the monorepo build needs the workspace).
   `packages/frontend/vercel.json` already sets the install/build commands and
   output directory.
3. Environment variable (Production + Preview):
   - `NEXT_PUBLIC_API_URL` = `https://chronoflow-api.onrender.com` (your API URL)
4. Deploy, then set `CORS_ORIGIN` on the API to the Vercel domain and redeploy the
   API.

`NEXT_PUBLIC_API_URL` is inlined into the client bundle at **build** time — changing
it requires a new deployment, not just a redeploy of the same build.

### Custom domain / HTTPS

Vercel terminates TLS for the dApp. For the API, use Render's or Fly's TLS
endpoint; if you front the API with your own domain, remember to add it to
`CORS_ORIGIN`.

---

## 4. Post-deploy checklist

- [ ] `GET /health` → `{"status":"ok","indexer":{"running":true,...}}`
- [ ] `GET /api/stats` shows the expected contract id and a `lastLedger` that
      advances roughly every 5s
- [ ] The dApp loads, Connect Wallet prompts Freighter, and the header badge shows
      the right network
- [ ] Creating a vault appears in `GET /api/vaults` within a few seconds
- [ ] `Release Milestone` and `Clawback Escrow` produce explorer links
- [ ] `CORS_ORIGIN` includes the exact dApp origin (scheme + host, no trailing `/`)
- [ ] Secrets (`STELLAR_SECRET_KEY`, `DATABASE_URL`) live in the platform's secret
      store — never in the repository

---

## 5. Rollback

- **Contract**: contracts are immutable, so "rollback" means redeploying the
  previous `wasmHash` (recorded per deployment in `deployments/registry.json`)
  and re-running the app deployments with the regenerated module.
- **API**: revert the commit and redeploy; the indexer is idempotent (events are
  keyed by their RPC id) and resumes from its stored cursor.
- **dApp**: Vercel keeps every deployment; promote the previous one.
