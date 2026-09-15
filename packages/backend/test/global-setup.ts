import { execFileSync } from "node:child_process";

const TEST_DATABASE_URL = "file:./test.db";

/**
 * Recreates the test database schema with `prisma db push` before the suite
 * runs, so tests never depend on migration files or a running database server.
 */
export default function setup(): void {
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--force-reset", "--skip-generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
