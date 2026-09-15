#!/usr/bin/env bash
# Runs the Soroban host unit tests.
#
#   bash scripts/test.sh                 # whole suite
#   bash scripts/test.sh clawback        # filter by test name
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd cargo
cd "${CONTRACTS_DIR}"

if [ "$#" -gt 0 ]; then
  log "cargo test $*"
  cargo test "$@"
else
  log "cargo test --workspace"
  cargo test --workspace
fi
