#!/usr/bin/env bash
# Formatting check plus clippy with warnings denied (what CI runs).
#
#   bash scripts/lint.sh          # check only
#   bash scripts/lint.sh --fix    # apply rustfmt and clippy suggestions
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd cargo
cd "${CONTRACTS_DIR}"

if [ "${1:-}" = "--fix" ]; then
  log "cargo fmt --all"
  cargo fmt --all
  log "cargo clippy --fix"
  cargo clippy --all-targets --fix --allow-dirty --allow-staged
  exit 0
fi

log "cargo fmt --all --check"
cargo fmt --all -- --check

log "cargo clippy --all-targets -- -D warnings"
cargo clippy --all-targets -- -D warnings
