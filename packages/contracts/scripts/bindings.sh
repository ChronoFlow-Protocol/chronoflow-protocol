#!/usr/bin/env bash
# Generates the official Stellar TypeScript client package from the compiled WASM.
#
# Generating from the local wasm (instead of --contract-id) keeps this offline
# and reproducible: it only needs the build artifact, not a live deployment.
#
#   bash scripts/bindings.sh
#
# Output: packages/contracts/bindings/chronoflow-escrow/ (git-ignored, buildable
# with `npm install && npm run build` inside that directory).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_toolchain
ensure_wasm

log "Generating TypeScript bindings from $(basename "${WASM_FILE}")"
rm -rf "${BINDINGS_DIR}"
mkdir -p "$(dirname "${BINDINGS_DIR}")"
stellar contract bindings typescript --wasm "${WASM_FILE}" --output-dir "${BINDINGS_DIR}"

log "Bindings: ${BINDINGS_DIR}"
find "${BINDINGS_DIR}" -maxdepth 2 -type f | sed "s#${CONTRACTS_DIR}/#    #"
