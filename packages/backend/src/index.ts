import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { EventIndexer } from "./indexer/indexer.js";
import { createLogger } from "./lib/logger.js";
import { disconnectPrisma, getPrisma } from "./lib/prisma.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (config.contractId.length === 0) {
    logger.warn(
      "no contract id configured for this network - the indexer will stay idle. " +
        "Deploy with `pnpm --filter @chronoflow/contracts run deploy:testnet` or set CONTRACT_ID.",
    );
  }

  const prisma = getPrisma();
  await prisma.$connect();

  const indexer = new EventIndexer({ prisma, config, logger });

  if (config.indexer.enabled && config.contractId.length > 0) {
    await indexer.start();
  } else {
    logger.warn("indexer disabled", {
      enabled: config.indexer.enabled,
      hasContractId: config.contractId.length > 0,
    });
  }

  const app = createApp({ prisma, config, logger, indexer });
  const server = app.listen(config.port, config.host, () => {
    logger.info("http server listening", {
      url: `http://${config.host}:${config.port}`,
      network: config.stellarNetwork,
      contractId: config.contractId,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await indexer.stop();
    await disconnectPrisma();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // The logger is not available yet if configuration failed; stderr is enough.
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
