import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

/**
 * Returns the process-wide Prisma client.
 *
 * Prisma keeps a connection pool per client, so the whole process (HTTP layer
 * and indexer alike) shares a single instance.
 */
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
