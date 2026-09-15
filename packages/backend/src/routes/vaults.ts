import { Router } from "express";
import { z } from "zod";

import { VAULT_STATUS } from "../generated/chronoflow.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { badRequest, notFound } from "../lib/errors.js";
import { getVault, listVaults } from "../services/vaultService.js";
import type { RouteDeps } from "./deps.js";

const statusValues = [VAULT_STATUS.Active, VAULT_STATUS.Completed, VAULT_STATUS.ClawedBack];

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(statusValues).optional(),
  funder: z.string().min(1).optional(),
  recipient: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export function createVaultsRouter(deps: RouteDeps): Router {
  const router = Router();
  const decimals = deps.config.decimals;

  /** GET /api/vaults - newest first, filterable by status/participant/token. */
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest("invalid query parameters", parsed.error.issues);
      }

      const { items, total } = await listVaults(deps.prisma, parsed.data, decimals);
      res.json({
        data: items,
        meta: {
          total,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
          decimals,
        },
      });
    }),
  );

  /** GET /api/vaults/:id - full vault state, timeline and event log. */
  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw badRequest("vault id must be a positive integer", parsed.error.issues);
      }

      const vault = await getVault(deps.prisma, parsed.data.id, decimals);
      if (!vault) {
        throw notFound(`vault ${parsed.data.id} is not indexed`);
      }

      res.json({ data: vault, meta: { decimals } });
    }),
  );

  return router;
}
