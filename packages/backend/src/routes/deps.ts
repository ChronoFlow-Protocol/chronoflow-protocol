import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../config.js";
import type { IndexerStatusProvider } from "../indexer/indexer.js";
import type { Logger } from "../lib/logger.js";

export interface RouteDeps {
  prisma: PrismaClient;
  config: AppConfig;
  logger: Logger;
  indexer: IndexerStatusProvider;
}
