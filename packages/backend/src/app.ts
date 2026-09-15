import cors from "cors";
import express, { type Express } from "express";

import { CONTRACT_NAME } from "./generated/chronoflow.js";
import { createErrorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createHealthRouter } from "./routes/health.js";
import { createStatsRouter } from "./routes/stats.js";
import { createVaultsRouter } from "./routes/vaults.js";
import type { RouteDeps } from "./routes/deps.js";

export interface AppDeps extends RouteDeps {
  /** Service version reported by the root endpoint. */
  version?: string;
}

/**
 * Builds the HTTP app. Kept separate from `src/index.ts` so tests can exercise
 * the routes without binding a port or starting the indexer.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: deps.config.corsOrigin === "*" ? true : deps.config.corsOrigin }));
  app.use(express.json({ limit: "256kb" }));

  app.use((req, _res, next) => {
    deps.logger.debug("request", { method: req.method, path: req.path });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({
      service: "chronoflow-backend",
      contract: CONTRACT_NAME,
      version: deps.version ?? "1.0.0",
      network: deps.config.stellarNetwork,
      contractId: deps.config.contractId,
      endpoints: [
        "GET /api/vaults",
        "GET /api/vaults/:id",
        "GET /api/stats",
        "GET /health",
        "GET /health/ready",
      ],
    });
  });

  app.use("/health", createHealthRouter(deps));
  app.use("/api/vaults", createVaultsRouter(deps));
  app.use("/api/stats", createStatsRouter(deps));

  app.use(notFoundHandler);
  app.use(createErrorHandler(deps.logger));

  return app;
}
