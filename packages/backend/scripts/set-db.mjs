#!/usr/bin/env node
/**
 * Swaps prisma/schema.prisma between the SQLite and PostgreSQL variants.
 *
 *   node scripts/set-db.mjs postgres
 *   node scripts/set-db.mjs sqlite
 *
 * Both variants describe the same models; only the datasource provider differs.
 */

import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PRISMA_DIR = join(SCRIPT_DIR, "..", "prisma");
const TARGET = join(PRISMA_DIR, "schema.prisma");
const SOURCES = {
  sqlite: join(PRISMA_DIR, "schema.sqlite.prisma"),
  postgres: join(PRISMA_DIR, "schema.postgres.prisma"),
};

const requested = process.argv[2];
if (requested !== "sqlite" && requested !== "postgres") {
  process.stderr.write("usage: node scripts/set-db.mjs <sqlite|postgres>\n");
  process.exit(1);
}

const source = SOURCES[requested];
if (!existsSync(source)) {
  process.stderr.write(`missing ${source}\n`);
  process.exit(1);
}

copyFileSync(source, TARGET);
process.stdout.write(`prisma/schema.prisma now uses the ${requested} provider\n`);
process.stdout.write("run `pnpm db:generate` (or `pnpm db:push`) to apply it\n");
