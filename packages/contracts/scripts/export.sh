#!/usr/bin/env bash
# Exports the contract spec + deployment config to the backend and frontend
# packages. Uses whatever deployment is already in deployments/registry.json.
#
#   bash scripts/export.sh [--network testnet]
#
# Bindings themselves live in bindings/ (see scripts/bindings.sh); this script
# writes the generated `src/generated/chronoflow.ts` module that both app
# packages import for contract ids, event topics, error codes and spec types.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_toolchain
ensure_wasm

log "Exporting contract artifacts for network '${NETWORK}'"
node "${CONTRACTS_DIR}/scripts/export-artifacts.mjs" --network "${NETWORK}" "$@"
