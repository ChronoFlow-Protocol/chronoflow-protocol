# Contributing to chronoflow-protocol

Thanks for your interest in improving the ChronoFlow Protocol. This document covers the local
workflow, the standards we hold changes to, and how to get a pull request merged.

## Code of Conduct

Be respectful, assume good faith, and keep discussion focused on the technical problem. Harassment or
personal attacks are not tolerated in issues, pull requests, or any other project space.

## Prerequisites

| Tool        | Version         | Notes                                                                    |
| ----------- | --------------- | ------------------------------------------------------------------------ |
| Node.js     | `>= 22.13.0`    | `.nvmrc` pins the CI version                                             |
| pnpm        | `>= 11`         | workspace manager; `corepack enable` is the easiest install path         |
| Rust        | stable          | `rust-toolchain.toml` pins the toolchain, `clippy` and `rustfmt`         |
| wasm target | `wasm32v1-none` | `rustup target add wasm32v1-none`                                        |
| Stellar CLI | 28.x            | contract build, deploy and bindings — see `packages/contracts/README.md` |

```bash
corepack enable
rustup target add wasm32v1-none
pnpm install
```

## Repository layout

```
packages/contracts   Rust + Soroban escrow contract, unit tests, build/deploy/export scripts
packages/backend     Node + TypeScript indexer (Soroban RPC events), Prisma, Express REST API
packages/frontend    Next.js 14 App Router dApp (Tailwind, stellar-sdk, Freighter)
docs/                architecture and deployment guides
```

## Local development

```bash
# 1. Run everything CI runs
pnpm lint
pnpm typecheck
pnpm test

# 2. Contract work
pnpm --filter @chronoflow/contracts run build
pnpm --filter @chronoflow/contracts run test:coverage

# 3. Run the API + dApp together
pnpm --filter @chronoflow/backend run db:push
pnpm dev                       # backend :4000, dApp :3000
```

## Standards

- **Rust** must pass `cargo fmt --check` and `clippy -D warnings` with no `unsafe`. Contract coverage
  must stay above **85% lines** (`pnpm test:coverage`; currently ~98%).
- **TypeScript is strict** in both app packages. Do not weaken `tsconfig.json` to make one file pass —
  fix the file.
- **Tests are mandatory** for behavioural changes. Contract events are part of the public interface:
  if you rename or reshape one, update `src/test.rs`'s topic assertions and re-record the indexer
  fixture (`node packages/backend/scripts/capture-events.mjs`).
- **Generated code is not edited by hand.** `src/generated/chronoflow.ts` in both app packages comes
  from `packages/contracts/scripts/export-artifacts.mjs`; regenerate it with `pnpm run export` (or a
  deploy) and commit the result alongside contract changes.
- **No secrets in the repo.** Deployer keys, RPC urls and database URLs come from `.env` files or the
  hosting platform's secret store; both are git-ignored.
- **Formatting** is Prettier for TS/JSON/MD/YAML (`pnpm format`) and rustfmt for Rust. Run both
  before pushing.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
`refactor:`, `chore:`, `ci:`. Keep the subject under 72 characters and explain _why_ in the body when
the change is not self-evident.

## Pull requests

1. Fork and branch from `main` (`git switch -c feat/short-description`).
2. Make the change, then run `pnpm lint && pnpm typecheck && pnpm test`.
3. If the contract changed, include the regenerated artifacts (deployments registry, generated
   modules) in the same PR.
4. Open the PR against `main` describing what changed, why, and how you verified it.
5. CI must be green before review — the contract job builds the wasm, the coverage job enforces the
   85% line floor, and the two app jobs lint, typecheck, test and build.

## Reporting bugs

Include the affected package, the exact command you ran, the observed output, and the expected
behaviour. For contract issues, include the vault parameters (amount, duration, milestones) and the
transaction hash or explorer link if you have one.

## Security

Do not open a public issue for a vulnerability. Contact the maintainers privately and allow time for a
fix before disclosure.
