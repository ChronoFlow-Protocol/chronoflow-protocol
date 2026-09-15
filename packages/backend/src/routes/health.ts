import { Router } from "express";

import { asyncHandler } from "../lib/asyncHandler.js";
import type { RouteDeps } from "./deps.js";

const startedAt = Date.now();

export function createHealthRouter(deps: RouteDeps): Router {
  const router = Router();

  /** GET /health - liveness for Render/Fly/Vercel health checks. */
  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const indexer = deps.indexer.snapshot();
      res.json({
        status: "ok",
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        network: deps.config.stellarNetwork,
        contractId: deps.config.contractId,
        indexer: {
          running: indexer.running,
          lastLedger: indexer.lastLedger,
          latestLedger: indexer.latestLedger,
          lastPollAt: indexer.lastPollAt,
          lastError: indexer.lastError,
        },
      });
    }),
  );

  /** GET /health/ready - verifies the database is reachable. */
  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      await deps.prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    }),
  );

  return router;
}
