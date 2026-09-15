import { PrismaClient } from "@prisma/client";

import { applyDecodedEvent } from "../../src/indexer/handlers.js";
import type { DecodedEvent } from "../../src/indexer/decode.js";

/**
 * A Prisma client bound to the throwaway test database created by
 * test/global-setup.ts (DATABASE_URL is set by vitest.config.ts).
 */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}

/** Empties every table, keeping the schema in place. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.vaultEvent.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.indexerCursor.deleteMany();
}

/** Folds events in order, exactly like the indexer does. */
export async function seedEvents(
  prisma: PrismaClient,
  events: readonly DecodedEvent[],
): Promise<number> {
  let applied = 0;
  for (const event of events) {
    if (await applyDecodedEvent(prisma, event)) applied += 1;
  }
  return applied;
}
