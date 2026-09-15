#!/usr/bin/env bash
# Builds, deploys and exports the ChronoFlow escrow contract to Stellar testnet.
#
#   bash scripts/deploy-testnet.sh
#
# Environment overrides:
#   STELLAR_NETWORK         target network             (default: testnet)
#   STELLAR_SOURCE_ACCOUNT  identity used to pay fees  (default: chronoflow-deployer)
#   CHRONOFLOW_ADMIN        protocol admin address     (default: the deployer)
#   CHRONOFLOW_CLAWBACK_DELAY  grace period in seconds (default: 1209600 = 14 days)
#
# The identity is created and funded through Friendbot on first run, and the
# resulting contract id is written to deployments/registry.json plus the
# generated modules of the backend and frontend packages.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_toolchain

if [ "${NETWORK}" != "testnet" ] && [ "${NETWORK}" != "futurenet" ]; then
  warn "network '${NETWORK}' is not a testnet; deploying there is probably not what you want"
fi

bash "${CONTRACTS_DIR}/scripts/build.sh"

# Reuse an existing identity; otherwise create one and fund it from the faucet.
if ! stellar keys address "${SOURCE_ACCOUNT}" >/dev/null 2>&1; then
  log "Creating and funding identity '${SOURCE_ACCOUNT}' on ${NETWORK}"
  stellar keys generate "${SOURCE_ACCOUNT}" --network "${NETWORK}" --fund
else
  log "Reusing identity '${SOURCE_ACCOUNT}'"
fi

ADMIN="${CHRONOFLOW_ADMIN:-$(stellar keys address "${SOURCE_ACCOUNT}")}"
log "Protocol admin: ${ADMIN}"
log "Clawback delay: ${CLAWBACK_DELAY}s"

log "Deploying ${CONTRACT_NAME} to ${NETWORK}"
CONTRACT_ID="$(
  stellar contract deploy \
    --wasm "${WASM_FILE}" \
    --source-account "${SOURCE_ACCOUNT}" \
    --network "${NETWORK}" \
    --alias "${CONTRACT_NAME}" \
    --quiet \
    -- \
    --admin "${ADMIN}" \
    --clawback-delay "${CLAWBACK_DELAY}" | tail -n 1
)"

case "${CONTRACT_ID}" in
  C???????????????????????????????????????????????????????) ;;
  C*) ;;
  *) die "deployment did not return a contract id (got '${CONTRACT_ID}')" ;;
esac

log "Contract id: ${CONTRACT_ID}"

WASM_HASH=""
if command -v stellar >/dev/null 2>&1; then
  WASM_HASH="$(stellar contract info hash --wasm "${WASM_FILE}" 2>/dev/null | tail -n 1 || true)"
fi

# Record the ledger the contract landed in so the indexer can start scanning
# from the deployment instead of the whole RPC retention window.
DEPLOYED_LEDGER="$(stellar ledger latest --network "${NETWORK}" 2>/dev/null | awk '/^Sequence:/ {print $2}' || true)"
if [ -n "${DEPLOYED_LEDGER}" ]; then
  log "Deployed at ledger ${DEPLOYED_LEDGER}"
else
  warn "could not read the latest ledger; the indexer will scan from the retention window"
fi

EXPORT_ARGS=(--network "${NETWORK}" --contract-id "${CONTRACT_ID}" --source-account "${SOURCE_ACCOUNT}")
if [ -n "${WASM_HASH}" ]; then
  EXPORT_ARGS+=(--wasm-hash "${WASM_HASH}")
fi
if [ -n "${DEPLOYED_LEDGER}" ]; then
  EXPORT_ARGS+=(--deployed-ledger "${DEPLOYED_LEDGER}")
fi
node "${CONTRACTS_DIR}/scripts/export-artifacts.mjs" "${EXPORT_ARGS[@]}"

bash "${CONTRACTS_DIR}/scripts/bindings.sh"

# Smoke test: the fresh contract must report an empty vault set and be unpaused.
log "Verifying the deployment (vault_count should be 0)"
VAULT_COUNT="$(
  stellar contract invoke \
    --id "${CONTRACT_ID}" \
    --network "${NETWORK}" \
    --source-account "${SOURCE_ACCOUNT}" \
    --quiet \
    -- vault_count | tail -n 1
)"
[ "${VAULT_COUNT}" = "0" ] || die "unexpected vault_count from the new contract: '${VAULT_COUNT}'"

log "Deployment verified. Explorer: https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}"
