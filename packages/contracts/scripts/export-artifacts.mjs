#!/usr/bin/env node
/**
 * Exports the compiled ChronoFlow contract to the rest of the monorepo.
 *
 * What it does:
 *  1. Reads the contract spec out of the compiled WASM using the Stellar CLI
 *     (`stellar contract info interface --output json`), so every name, field,
 *     event topic and error code below is derived from the real artifact rather
 *     than hand-maintained.
 *  2. Records the deployment (contract id, wasm hash, network config) in
 *     `deployments/registry.json` and `deployments/<network>.json`.
 *  3. Regenerates the typed contract module that ships inside the frontend and
 *     backend packages (`src/generated/chronoflow.ts`).
 *
 * Usage (normally invoked through `scripts/deploy-testnet.sh`):
 *
 *   node scripts/export-artifacts.mjs \
 *     --wasm wasm/chronoflow_escrow.wasm \
 *     --network testnet \
 *     --contract-id CABC... \
 *     --wasm-hash 9f2c... \
 *     --source-account chronoflow-deployer
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(CONTRACTS_DIR, "..", "..");

const CONTRACT_NAME = "chronoflow-escrow";
const CONTRACT_CRATE_DIR = join(CONTRACTS_DIR, "contracts", CONTRACT_NAME);
const DEFAULT_WASM = join(CONTRACTS_DIR, "wasm", "chronoflow_escrow.wasm");
const REGISTRY_FILE = join(CONTRACTS_DIR, "deployments", "registry.json");

/** Generated module targets: every app package consumes the same shape. */
const GENERATED_TARGETS = [
  join(REPO_ROOT, "packages", "backend", "src", "generated", "chronoflow.ts"),
  join(REPO_ROOT, "packages", "frontend", "src", "generated", "chronoflow.ts"),
];

/** Well-known network defaults, overridable per call with `--rpc-url` etc. */
const NETWORK_DEFAULTS = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
    // Stellar Asset Contract for the native asset (XLM) on this network.
    nativeAssetContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  futurenet: {
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
    // No well-known native SAC on futurenet; leave unset rather than guess.
    nativeAssetContractId: null,
  },
  mainnet: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    friendbotUrl: null,
    nativeAssetContractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  },
  local: {
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
    friendbotUrl: "http://localhost:8000/friendbot",
  },
};

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { network: "testnet" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const network = String(args.network ?? "testnet");
const wasmPath = resolve(String(args.wasm ?? DEFAULT_WASM));
const networkDefaults = NETWORK_DEFAULTS[network] ?? {
  rpcUrl: "",
  networkPassphrase: "",
  friendbotUrl: null,
};

// ---------------------------------------------------------------------------
// Spec extraction
// ---------------------------------------------------------------------------

function readContractSpec() {
  if (!existsSync(wasmPath)) {
    fail(
      `compiled wasm not found at ${relative(REPO_ROOT, wasmPath)}\n` +
        `       run \`bash scripts/build.sh\` (or \`stellar contract build\`) first`,
    );
  }

  let raw;
  try {
    raw = execFileSync(
      "stellar",
      ["contract", "info", "interface", "--wasm", wasmPath, "--output", "json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    fail(
      "could not read the contract interface with the Stellar CLI.\n" +
        "       Make sure `stellar` is on your PATH (see packages/contracts/README.md).\n" +
        `       ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`the Stellar CLI returned output that is not JSON: ${String(error)}`);
  }
}

function fail(message) {
  process.stderr.write(`\u001b[1;31merror:\u001b[0m ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Naming helpers (mirror what soroban-sdk does for event topics)
// ---------------------------------------------------------------------------

const toSnakeCase = (name) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();

const toCamelCase = (name) =>
  toSnakeCase(name).replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());

const toUpperSnakeCase = (name) => toSnakeCase(name).toUpperCase();

// ---------------------------------------------------------------------------
// Spec → TypeScript
// ---------------------------------------------------------------------------

const SCALAR_TYPES = {
  address: "string",
  string: "string",
  symbol: "string",
  bytes: "Uint8Array",
  bool: "boolean",
  void: "void",
  u32: "number",
  i32: "number",
  u64: "bigint",
  i64: "bigint",
  u128: "bigint",
  i128: "bigint",
  u256: "bigint",
  i256: "bigint",
  timepoint: "bigint",
  duration: "bigint",
};

function tsType(type) {
  if (typeof type === "string") {
    return SCALAR_TYPES[type] ?? "unknown";
  }
  if (type.udt) return type.udt.name;
  if (type.vec) return `${tsType(type.vec.element_type)}[]`;
  if (type.option) return `${tsType(type.option.value_type)} | null`;
  if (type.result) return tsType(type.result.ok_type);
  if (type.map) {
    return `Record<${tsType(type.map.key_type)}, ${tsType(type.map.value_type)}>`;
  }
  if (type.tuple) {
    return `[${(type.tuple.value_types ?? []).map(tsType).join(", ")}]`;
  }
  return "unknown";
}

function indexSpec(spec) {
  const functions = [];
  const structs = [];
  const unions = [];
  const errors = [];
  const events = [];

  for (const entry of spec) {
    if (entry.function_v0) functions.push(entry.function_v0);
    else if (entry.udt_struct_v0) structs.push(entry.udt_struct_v0);
    else if (entry.udt_union_v0) unions.push(entry.udt_union_v0);
    else if (entry.udt_error_enum_v0) errors.push(entry.udt_error_enum_v0);
    else if (entry.event_v0) events.push(entry.event_v0);
  }

  return { functions, structs, unions, errors, events };
}

function renderUnion(union) {
  const variants = union.cases
    .map((entry) => {
      const variant = entry.void_v0 ?? entry.tuple_v0 ?? entry.struct_v0;
      return JSON.stringify(variant?.name ?? "");
    })
    .join(" | ");

  const values = union.cases
    .map((entry) => {
      const variant = entry.void_v0 ?? entry.tuple_v0 ?? entry.struct_v0;
      return `  ${variant.name}: ${JSON.stringify(variant.name)},`;
    })
    .join("\n");

  return `/**
 * ${union.doc || union.name}
 *
 * Mirrors \`${union.name}\` in the contract spec.
 */
export type ${union.name} = ${variants};

export const ${toUpperSnakeCase(union.name)} = {
${values}
} as const;
`;
}

function renderStruct(struct) {
  const fields = struct.fields
    .map((field) => `  /** \`${field.type}\` */\n  ${field.name}: ${tsType(field.type)};`)
    .join("\n");

  return `/** ${struct.doc || struct.name} */\nexport interface ${struct.name} {\n${fields}\n}\n`;
}

function renderEvent(event) {
  // `params` carries both the topic and data fields, tagged with `location`.
  const params = event.params ?? event.fields ?? [];
  const topicFields = params.filter((field) => field.location === "topic_list");
  const dataFields = params.filter((field) => field.location === "data");

  // The fixed topics of an event come straight from the compiled spec; the
  // first one is what the indexer subscribes to. The fallback mirrors what
  // soroban-sdk does when no explicit `topics = [..]` is given.
  const prefixTopics = event.prefix_topics?.length
    ? event.prefix_topics
    : [toSnakeCase(event.name)];
  const topicSymbol = prefixTopics[0];

  const payloadFields = params
    .map((field) => {
      const origin = field.location === "topic_list" ? "topic" : "data";
      return `  /** \`${field.type}\` — ${origin} */\n  ${field.name}: ${tsType(field.type)};`;
    })
    .join("\n");

  return {
    topicSymbol,
    code: `/** \`${event.name}\` — topics start with \`${prefixTopics.map((t) => `"${t}"`).join(", ")}\`. */
export interface ${event.name}Event {
${payloadFields}
}
`,
    shape: `  ${topicSymbol}: {
    topic: ${JSON.stringify(topicSymbol)},
    specName: ${JSON.stringify(event.name)},
    prefixTopics: [${prefixTopics.map((t) => JSON.stringify(t)).join(", ")}],
    dataFormat: ${JSON.stringify(event.data_format ?? "map")},
    topicFields: [${topicFields.map((f) => JSON.stringify(f.name)).join(", ")}],
    dataFields: [${dataFields.map((f) => JSON.stringify(f.name)).join(", ")}],
  },`,
  };
}

function renderGeneratedModule(spec, registry, activeNetwork) {
  const { functions, structs, unions, errors, events } = indexSpec(spec);

  const methods = functions
    .filter((fn) => !fn.name.startsWith("__"))
    .map((fn) => toCamelCase(fn.name))
    .sort();

  const methodDoc = functions
    .filter((fn) => !fn.name.startsWith("__"))
    .map((fn) => {
      const signature = fn.inputs.map((input) => `${input.name}: ${tsType(input.type)}`).join(", ");
      return `  /** \`${fn.name}(${signature})\` */\n  ${toCamelCase(fn.name)}: ${JSON.stringify(fn.name)},`;
    })
    .join("\n");

  const errorCases = errors[0]?.cases ?? [];
  const errorEntries = errorCases
    .map((entry) => `  ${JSON.stringify(entry.value)}: ${JSON.stringify(entry.name)},`)
    .join("\n");
  const errorNames = errorCases.map((entry) => `  ${entry.name}: ${entry.value},`).join("\n");

  const renderedEvents = events.map(renderEvent);

  const deploymentEntries = Object.entries(registry)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const fields = [
        `    network: ${JSON.stringify(value.network ?? key)},`,
        `    contractId: ${JSON.stringify(value.contractId ?? "")},`,
        value.wasmHash ? `    wasmHash: ${JSON.stringify(value.wasmHash)},` : null,
        `    rpcUrl: ${JSON.stringify(value.rpcUrl ?? "")},`,
        `    networkPassphrase: ${JSON.stringify(value.networkPassphrase ?? "")},`,
        value.friendbotUrl ? `    friendbotUrl: ${JSON.stringify(value.friendbotUrl)},` : null,
        value.nativeAssetContractId
          ? `    nativeAssetContractId: ${JSON.stringify(value.nativeAssetContractId)},`
          : null,
        `    deployedAt: ${JSON.stringify(value.deployedAt ?? "")},`,
        Number.isFinite(value.deployedLedger)
          ? `    deployedLedger: ${Number(value.deployedLedger)},`
          : null,
        value.sourceAccount ? `    sourceAccount: ${JSON.stringify(value.sourceAccount)},` : null,
      ].filter(Boolean);
      return `  ${JSON.stringify(key)}: {\n${fields.join("\n")}\n  },`;
    })
    .join("\n");

  return `/* eslint-disable */
/* biome-ignore-all lint: generated from the compiled contract spec */

/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 *
 * Sources:
 *   packages/contracts/contracts/${CONTRACT_NAME}/src/lib.rs   (contract source)
 *   packages/contracts/wasm/chronoflow_escrow.wasm             (compiled spec)
 *   packages/contracts/deployments/registry.json               (deployments)
 *
 * Regenerate with:
 *   pnpm --filter @chronoflow/contracts run export        # config only
 *   pnpm --filter @chronoflow/contracts run deploy:testnet  # deploy + config
 *
 * Field names follow the contract spec (snake_case) so they line up exactly
 * with the objects \`scValToNative\` returns from the Soroban RPC, and event
 * topic symbols are read from the spec's prefix topics.
 */

export const CONTRACT_NAME = ${JSON.stringify(CONTRACT_NAME)};

/** Soroban method names, excluding \`__constructor\`. */
export const CONTRACT_METHODS = [
${methods.map((method) => `  ${JSON.stringify(method)},`).join("\n")}
] as const;

export type ContractMethod = (typeof CONTRACT_METHODS)[number];

/** camelCase → Soroban method name. */
export const METHODS = {
${methodDoc}
} as const;

/** Contract error codes (\`ContractError(n)\` in diagnostics). */
export const ERROR_CODES = {
${errorNames}
} as const;

export type ContractErrorName = keyof typeof ERROR_CODES;

/** Numeric code → error name. */
export const ERROR_NAMES: Record<number, ContractErrorName> = {
${errorEntries}
};

${renderedEvents.map((event) => event.code).join("\n")}

/**
 * Event shapes as published by the contract.
 *
 * \`topicFields\` are carried in the event topics (after \`topic\`),
 * \`dataFields\` live in the event's data map.
 */
export interface ContractEventShape {
  /** First topic of the event — what the indexer filters on. */
  topic: string;
  /** Rust type name of the event. */
  specName: string;
  /** Fixed topics published before the topic fields. */
  prefixTopics: readonly string[];
  /** How the data section is encoded: map, vec or single-value. */
  dataFormat: string;
  /** Fields carried in the event topics, after the prefix topics. */
  topicFields: readonly string[];
  /** Fields carried in the event's data section. */
  dataFields: readonly string[];
}

export const EVENTS: Record<string, ContractEventShape> = {
${renderedEvents.map((event) => event.shape).join("\n")}
};

/** Topics the backend indexer subscribes to. */
export const INDEXED_EVENT_TOPICS = [
${renderedEvents.map((event) => `  ${JSON.stringify(event.topicSymbol)},`).join("\n")}
] as const;

${unions.map(renderUnion).join("\n")}
${structs.map(renderStruct).join("\n")}
/** A recorded deployment of the escrow contract. */
export interface ContractDeployment {
  network: string;
  contractId: string;
  wasmHash?: string;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl?: string;
  /** Stellar Asset Contract of the native asset on this network, when known. */
  nativeAssetContractId?: string;
  deployedAt: string;
  /** Ledger the contract was created in; the indexer scans forward from here. */
  deployedLedger?: number;
  sourceAccount?: string;
}

/** Every known deployment, keyed by network name. */
export const DEPLOYMENTS: Record<string, ContractDeployment> = {
${deploymentEntries}
};

/** Network this export was generated for. */
export const NETWORK = ${JSON.stringify(activeNetwork)};

export const ACTIVE_DEPLOYMENT: ContractDeployment | null = DEPLOYMENTS[NETWORK] ?? null;

/** Contract id on \`NETWORK\`, or an empty string when not deployed yet. */
export const CONTRACT_ID = ACTIVE_DEPLOYMENT?.contractId ?? "";

export const RPC_URL = ACTIVE_DEPLOYMENT?.rpcUrl ?? "";

export const NETWORK_PASSPHRASE = ACTIVE_DEPLOYMENT?.networkPassphrase ?? "";

export const FRIENDBOT_URL = ACTIVE_DEPLOYMENT?.friendbotUrl ?? "";

/** Ledger the active contract was created in, or 0 when unknown. */
export const DEPLOYED_LEDGER = ACTIVE_DEPLOYMENT?.deployedLedger ?? 0;

/**
 * Stellar Asset Contract for the native asset (XLM) on {@link NETWORK}, or an
 * empty string when the network has none (for example a local standalone node,
 * where the asset must be deployed first).
 */
export const NATIVE_ASSET_CONTRACT_ID = ACTIVE_DEPLOYMENT?.nativeAssetContractId ?? "";

/** True when this network has a deployed contract. */
export const IS_DEPLOYED = CONTRACT_ID.length > 0;
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function readRegistry() {
  if (!existsSync(REGISTRY_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
  } catch (error) {
    fail(`deployments/registry.json is not valid JSON: ${String(error)}`);
  }
}

const spec = readContractSpec();
const registry = readRegistry();

if (args["contract-id"]) {
  registry[network] = {
    network,
    contractId: String(args["contract-id"]),
    ...(args["wasm-hash"] ? { wasmHash: String(args["wasm-hash"]) } : {}),
    rpcUrl: String(args["rpc-url"] ?? networkDefaults.rpcUrl),
    networkPassphrase: String(args["network-passphrase"] ?? networkDefaults.networkPassphrase),
    ...(networkDefaults.friendbotUrl ? { friendbotUrl: networkDefaults.friendbotUrl } : {}),
    ...(networkDefaults.nativeAssetContractId
      ? { nativeAssetContractId: networkDefaults.nativeAssetContractId }
      : {}),
    deployedAt: new Date().toISOString(),
    ...(args["deployed-ledger"] !== undefined && Number.isFinite(Number(args["deployed-ledger"]))
      ? { deployedLedger: Number(args["deployed-ledger"]) }
      : {}),
    ...(args["source-account"] ? { sourceAccount: String(args["source-account"]) } : {}),
    wasm: relative(CONTRACTS_DIR, wasmPath),
  };
} else if (!registry[network]) {
  // Keep network configuration available (rpc url, passphrase) even before the
  // first deployment, so app packages can render "not deployed yet" states.
  registry[network] = {
    network,
    contractId: "",
    rpcUrl: networkDefaults.rpcUrl,
    networkPassphrase: networkDefaults.networkPassphrase,
    ...(networkDefaults.friendbotUrl ? { friendbotUrl: networkDefaults.friendbotUrl } : {}),
    deployedAt: "",
  };
}

mkdirSync(dirname(REGISTRY_FILE), { recursive: true });
writeFileSync(REGISTRY_FILE, `${JSON.stringify(registry, null, 2)}\n`);

const deploymentsDir = join(CONTRACTS_DIR, "deployments");
mkdirSync(deploymentsDir, { recursive: true });
writeFileSync(
  join(deploymentsDir, `${network}.json`),
  `${JSON.stringify(registry[network], null, 2)}\n`,
);

const moduleSource = renderGeneratedModule(spec, registry, network);
for (const target of GENERATED_TARGETS) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, moduleSource);
}

const { functions, events, structs } = indexSpec(spec);
process.stdout.write(
  [
    `\u001b[1;36m==>\u001b[0m exported ${CONTRACT_NAME} for network "${network}"`,
    `    contract id      : ${registry[network].contractId || "(not deployed)"}`,
    `    rpc url          : ${registry[network].rpcUrl}`,
    `    spec             : ${functions.length} functions, ${events.length} events, ${structs.length} structs`,
    `    registry         : ${relative(REPO_ROOT, REGISTRY_FILE)}`,
    ...GENERATED_TARGETS.map((target) => `    generated module : ${relative(REPO_ROOT, target)}`),
    "",
  ].join("\n"),
);
