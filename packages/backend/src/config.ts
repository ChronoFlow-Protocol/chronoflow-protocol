import "dotenv/config";

import { z } from "zod";

import {
  CONTRACT_ID as GENERATED_CONTRACT_ID,
  DEPLOYED_LEDGER as GENERATED_DEPLOYED_LEDGER,
  NETWORK as GENERATED_NETWORK,
  NETWORK_PASSPHRASE as GENERATED_NETWORK_PASSPHRASE,
  RPC_URL as GENERATED_RPC_URL,
} from "./generated/chronoflow.js";

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** HTTP server */
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGIN: z.string().min(1).default("*"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  /** Storage */
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),

  /**
   * Decimals applied when rendering base-unit amounts for display. Soroban
   * assets are stroop-denominated by default (1 XLM = 10^7 stroops).
   */
  TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(7),

  /** Stellar / Soroban */
  STELLAR_NETWORK: z.string().min(1).default(GENERATED_NETWORK),
  SOROBAN_RPC_URL: z.string().min(1).default(GENERATED_RPC_URL),
  CONTRACT_ID: z.string().min(1).default(GENERATED_CONTRACT_ID),
  NETWORK_PASSPHRASE: z.string().min(1).default(GENERATED_NETWORK_PASSPHRASE),

  /** Indexer */
  INDEXER_ENABLED: booleanish.default(true),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  INDEXER_PAGE_SIZE: z.coerce.number().int().min(1).max(1_000).default(200),
  /**
   * First ledger to scan. Defaults to the ledger the contract was deployed in,
   * which is recorded by the deploy script. Starting there instead of at the
   * RPC's oldest retained ledger matters: the RPC returns no events at all for
   * a window that reaches back before its event retention.
   */
  INDEXER_START_LEDGER: z.coerce.number().int().nonnegative().optional(),
});

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  corsOrigin: string;
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
  databaseUrl: string;
  decimals: number;
  stellarNetwork: string;
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
  indexer: Readonly<{
    enabled: boolean;
    pollIntervalMs: number;
    pageSize: number;
    startLedger?: number;
  }>;
}>;

/**
 * Parses and validates configuration. Throws with a readable message listing
 * every invalid variable, so a bad deploy fails immediately instead of at the
 * first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  const startLedger = value.INDEXER_START_LEDGER ?? GENERATED_DEPLOYED_LEDGER;

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    corsOrigin: value.CORS_ORIGIN,
    logLevel: value.LOG_LEVEL,
    databaseUrl: value.DATABASE_URL,
    decimals: value.TOKEN_DECIMALS,
    stellarNetwork: value.STELLAR_NETWORK,
    rpcUrl: value.SOROBAN_RPC_URL,
    contractId: value.CONTRACT_ID,
    networkPassphrase: value.NETWORK_PASSPHRASE,
    indexer: {
      enabled: value.INDEXER_ENABLED,
      pollIntervalMs: value.INDEXER_POLL_INTERVAL_MS,
      pageSize: value.INDEXER_PAGE_SIZE,
      ...(!startLedger ? {} : { startLedger }),
    },
  };
}
