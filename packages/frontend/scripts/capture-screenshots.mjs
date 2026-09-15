#!/usr/bin/env node
/**
 * Captures the running dashboard into `docs/images/` for the README.
 *
 *   # terminal 1: the indexer API (so vaults and stats have data)
 *   pnpm --filter @chronoflow/backend run db:push
 *   DATABASE_URL="file:./dev.db" INDEXER_ENABLED=true node packages/backend/dist/index.js
 *
 *   # terminal 2: the built dApp
 *   pnpm --filter @chronoflow/frontend run build
 *   pnpm --filter @chronoflow/frontend run start -- -p 3100
 *
 *   # terminal 3
 *   pnpm --filter @chronoflow/frontend run screenshots            # http://localhost:3100
 *   pnpm --filter @chronoflow/frontend run screenshots -- https://your-dapp.vercel.app
 *
 * One-time browser download: `pnpm --filter @chronoflow/frontend exec playwright install chromium`.
 *
 * The wallet stays disconnected (the Freighter extension cannot be automated),
 * so the shots show real indexed vault data with the connect prompt visible.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
const REPO_ROOT = join(HERE, "..", "..", "..");
const OUT_DIR = join(REPO_ROOT, "docs", "images");

// Containers without Chromium's system libraries stage them locally with
// `node scripts/fetch-browser-deps.mjs`; pick them up when present.
const LOCAL_LIBS = join(PACKAGE_DIR, ".browser-deps", "usr", "lib", "x86_64-linux-gnu");
if (existsSync(LOCAL_LIBS)) {
  process.env.LD_LIBRARY_PATH = [LOCAL_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
}

const { chromium } = await import("playwright");

const BASE_URL = (process.argv[2] ?? process.env.DASHBOARD_URL ?? "http://localhost:3100").replace(
  /\/+$/,
  "",
);

const DESKTOP = { width: 1400, height: 1000 };
const MOBILE = { width: 390, height: 844 };

// Full-page shots stay at 1x (they are tall and would otherwise dominate the
// repository); panel close-ups are captured at 2x so text stays sharp on
// high-DPI displays.
const FULL_PAGE_SCALE = 1;
const CLOSE_UP_SCALE = 2;

/** Waits for the dashboard to finish its first data fetch. */
async function settle(page, timeout = 20_000) {
  await page
    .getByRole("heading", { name: /time-locked escrow with milestone streaming/i })
    .waitFor({
      timeout,
    });
  // The vault list renders either cards or an empty state once the API replies.
  await page
    .locator('[data-testid="vault-list"]')
    .getByText(/no vaults yet|vaults match this filter|vault ·|vaults ·/i)
    .first()
    .waitFor({ timeout })
    .catch(() => {});
  await page.waitForTimeout(1_200);
}

async function shoot(page, name, options = {}) {
  const path = join(OUT_DIR, name);
  await page.screenshot({ path, ...options });
  const kb = Math.round(statSync(path).size / 1024);
  process.stdout.write(`  ${relative(REPO_ROOT, path)}  (${kb} kB)\n`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const errors = [];

  try {
    process.stdout.write(`capturing ${BASE_URL}\n`);

    // ---- desktop overview: hero, stats, create form, vault timelines --------
    const overview = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: FULL_PAGE_SCALE,
      reducedMotion: "reduce",
    });
    const page = await overview.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await settle(page);

    // Expand the first vault's contract event log so the screenshot shows the
    // indexed VaultCreated / MilestoneReleased rows too.
    const logToggle = page.getByRole("button", { name: /show contract event log/i }).first();
    if ((await logToggle.count()) > 0) {
      await logToggle.click();
      await page.waitForTimeout(400);
    }

    await shoot(page, "dashboard.png", { fullPage: true });
    await overview.close();

    // ---- panel close-ups at 2x --------------------------------------------
    const crisp = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: CLOSE_UP_SCALE,
      reducedMotion: "reduce",
    });
    const crispPage = await crisp.newPage();
    await crispPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await settle(crispPage);

    // Newest vault first: shows fully timelocked milestones. The oldest vault is
    // the one that already has a released milestone and an indexed event log.
    const cards = crispPage.locator('[data-testid="vault-card"]');
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await shoot(cards.first(), "vault-timeline.png", { animations: "disabled" });
      if (cardCount > 1) {
        await shoot(cards.last(), "vault-released.png", { animations: "disabled" });
      }
    } else {
      process.stdout.write("  (no vault cards — skipped the vault close-ups)\n");
    }

    await shoot(crispPage.locator('[data-testid="create-vault-form"]'), "create-vault.png");
    await shoot(crispPage.locator('[data-testid="stats-grid"]'), "protocol-stats.png", {
      animations: "disabled",
    });
    await crisp.close();

    // ---- mobile (viewport only: the page is far too tall to show in full) ---
    const mobile = await browser.newContext({
      viewport: MOBILE,
      deviceScaleFactor: CLOSE_UP_SCALE,
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await settle(mobilePage);
    await shoot(mobilePage, "dashboard-mobile.png");
    await mobile.close();

    if (errors.length > 0) {
      process.stdout.write(`\npage console errors (${errors.length}):\n`);
      for (const error of errors.slice(0, 5)) process.stdout.write(`  - ${error}\n`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`\nscreenshot capture failed: ${String(error)}\n`);
  process.stderr.write(
    "Is the dApp running? Start it with `pnpm --filter @chronoflow/frontend run start -- -p 3100`.\n",
  );
  process.exit(1);
});
