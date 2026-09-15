#!/usr/bin/env bash
# Shared helpers for the ChronoFlow contract scripts.
#
# Source from a sibling script:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

set -euo pipefail

# rustup installs its binaries in ~/.cargo/bin, and it is commonly installed
# with --no-modify-path, so make sure cargo/stellar are reachable even when the
# invoking shell has not sourced ~/.cargo/env.
if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.cargo/env"
fi
if [ -d "${HOME}/.cargo/bin" ]; then
  case ":${PATH}:" in
    *":${HOME}/.cargo/bin:"*) ;;
    *) export PATH="${HOME}/.cargo/bin:${PATH}" ;;
  esac
fi

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${CONTRACTS_DIR}/../.." && pwd)"
CONTRACT_NAME="${CONTRACT_NAME:-chronoflow-escrow}"
WASM_DIR="${CONTRACTS_DIR}/wasm"
WASM_FILE="${WASM_DIR}/chronoflow_escrow.wasm"
BINDINGS_DIR="${CONTRACTS_DIR}/bindings/chronoflow-escrow"

# Stellar network configuration. Override with env vars or flags.
NETWORK="${STELLAR_NETWORK:-testnet}"
SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-chronoflow-deployer}"
# 14 days, matching ChronoFlowEscrow::DEFAULT_CLAWBACK_DELAY.
CLAWBACK_DELAY="${CHRONOFLOW_CLAWBACK_DELAY:-1209600}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 ||
    die "'$1' is required but was not found on PATH. See packages/contracts/README.md."
}

require_toolchain() {
  require_cmd cargo
  require_cmd stellar
  require_cmd node
}

ensure_wasm() {
  if [ ! -f "${WASM_FILE}" ]; then
    warn "no compiled wasm found, building first"
    bash "${CONTRACTS_DIR}/scripts/build.sh"
  fi
}
