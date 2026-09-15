import { Router } from "express";

import { asyncHandler } from "../lib/asyncHandler.js";
import { getStats } from "../services/statsService.js";
import type { RouteDeps } from "./deps.js";

export function createStatsRouter(deps: RouteDeps): Router {
  const router = Router();

  /** GET /api/stats - protocol-wide aggregates and indexer health. */
  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const stats = await getStats(deps.prisma, {
        network: deps.config.stellarNetwork,
        contractId: deps.config.contractId,
        decimals: deps.config.decimals,
        indexer: deps.indexer.snapshot(),
      });

      res.json({ data: stats });
    }),
  );

  return router;
}
