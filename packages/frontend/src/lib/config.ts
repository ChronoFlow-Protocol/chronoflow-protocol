import {
  CONTRACT_ID,
  DEPLOYED_LEDGER,
  FRIENDBOT_URL,
  IS_DEPLOYED,
  NATIVE_ASSET_CONTRACT_ID,
  NETWORK,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from "@/generated/chronoflow";

const EXPLORER_BASE: Record<string, string> = {
  testnet: "https://stellar.expert/explorer/testnet",
  futurenet: "https://stellar.expert/explorer/futurenet",
  mainnet: "https://stellar.expert/explorer/public",
  local: "https://stellar.expert/explorer/testnet",
};

const explorerBase = EXPLORER_BASE[NETWORK] ?? EXPLORER_BASE.testnet ?? "";

/**
 * Everything the dApp needs to talk to the deployed contract.
 *
 * Contract id, RPC url and network passphrase come from the generated module the
 * deploy script writes, so pointing the UI at a new deployment only means
 * re-running `pnpm --filter @chronoflow/contracts run deploy:testnet`.
 */
export const stellarConfig = {
  network: NETWORK,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  contractId: CONTRACT_ID,
  nativeAssetContractId: NATIVE_ASSET_CONTRACT_ID,
  friendbotUrl: FRIENDBOT_URL,
  deployedLedger: DEPLOYED_LEDGER,
  isDeployed: IS_DEPLOYED,
  /** Native asset uses the standard 7 stroop decimals. */
  decimals: 7,
  explorer: {
    base: explorerBase,
    contract: (id: string) => `${explorerBase}/contract/${id}`,
    tx: (hash: string) => `${explorerBase}/tx/${hash}`,
    account: (address: string) => `${explorerBase}/account/${address}`,
  },
} as const;

/** Base URL of the ChronoFlow indexer API. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/+$/,
  "",
);
