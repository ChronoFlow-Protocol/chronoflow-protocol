#!/usr/bin/env bash
# Compiles the Soroban contract to WASM and copies the artifact into wasm/.
#
#   bash scripts/build.sh
#
# Requires the Stellar CLI and the wasm32v1-none Rust target (see README.md).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_toolchain

mkdir -p "${WASM_DIR}"

log "Building ${CONTRACT_NAME} for wasm32v1-none (release)"
cd "${CONTRACTS_DIR}"
stellar contract build --package "${CONTRACT_NAME}" --out-dir "${WASM_DIR}"

[ -f "${WASM_FILE}" ] || die "expected a wasm artifact at ${WASM_FILE}"
log "WASM artifact: ${WASM_FILE} ($(wc -c <"${WASM_FILE}" | tr -d ' ') bytes)"
