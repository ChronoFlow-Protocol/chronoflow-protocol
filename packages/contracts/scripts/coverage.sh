#!/usr/bin/env bash
# Measures contract code coverage with cargo-llvm-cov.
#
# One-time setup:
#   rustup component add llvm-tools-preview
#   cargo install cargo-llvm-cov --locked
#
# Then:
#   bash scripts/coverage.sh            # summary
#   bash scripts/coverage.sh --html     # plus target/llvm-cov/html/index.html
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd cargo
if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  die "cargo-llvm-cov is not installed. Run:
       rustup component add llvm-tools-preview
       cargo install cargo-llvm-cov --locked"
fi

cd "${CONTRACTS_DIR}"

if [ "${1:-}" = "--html" ]; then
  log "cargo llvm-cov --workspace --html"
  cargo llvm-cov --workspace --html
  log "HTML report: ${CONTRACTS_DIR}/target/llvm-cov/html/index.html"
else
  log "cargo llvm-cov --workspace --summary-only"
  cargo llvm-cov --workspace --summary-only
fi
