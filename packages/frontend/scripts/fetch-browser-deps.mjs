#!/usr/bin/env node
/**
 * Fetches the shared libraries headless Chromium needs into `.browser-deps/`
 * **without root**, for containers where `sudo playwright install-deps chromium`
 * is not an option.
 *
 *   pnpm --filter @chronoflow/frontend exec playwright install chromium
 *   node scripts/fetch-browser-deps.mjs
 *   LD_LIBRARY_PATH="$(node scripts/fetch-browser-deps.mjs --print-path)" pnpm run screenshots
 *
 * How it works: `ldd` reports the sonames the browser cannot resolve, this maps
 * each one to its Ubuntu package, walks the `Depends` closure through the archive
 * index (skipping anything already installed), downloads the `.deb` files and
 * extracts them under `.browser-deps/`. Nothing outside the package directory is
 * written and no system package manager state is touched.
 *
 * On a normal desktop the one-liner is easier:
 *   sudo pnpm exec playwright install-deps chromium
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
const DEPS_DIR = join(PACKAGE_DIR, ".browser-deps");
const LIB_DIR = join(DEPS_DIR, "usr", "lib", "x86_64-linux-gnu");
const CACHE_DIR = join(PACKAGE_DIR, ".browser-deps", ".deb-cache");

const ARCHIVE = "http://archive.ubuntu.com/ubuntu";
const INDEXES = [
  { suite: "noble", component: "main" },
  { suite: "noble", component: "universe" },
  { suite: "noble-updates", component: "main" },
  { suite: "noble-updates", component: "universe" },
];

/** Minimal soname → package map for the libraries Chromium links against. */
const PROVIDERS = {
  "libatk-1.0.so.0": "libatk1.0-0t64",
  "libatk-bridge-2.0.so.0": "libatk-bridge2.0-0t64",
  "libatspi.so.0": "libatspi2.0-0t64",
  "libasound.so.2": "libasound2t64",
  "libgbm.so.1": "libgbm1",
  "libxkbcommon.so.0": "libxkbcommon0",
  "libxcomposite.so.1": "libxcomposite1",
  "libxdamage.so.1": "libxdamage1",
  "libxfixes.so.3": "libxfixes3",
  "libxrandr.so.2": "libxrandr2",
  "libcups.so.2": "libcups2t64",
  "libpango-1.0.so.0": "libpango-1.0-0",
  "libpangocairo-1.0.so.0": "libpango-1.0-0",
  "libcairo.so.2": "libcairo2",
  "libnspr4.so": "libnspr4",
  "libnss3.so": "libnss3",
  "libdrm.so.2": "libdrm2",
  "libX11.so.6": "libx11-6",
  "libX11-xcb.so.1": "libx11-xcb1",
  "libXext.so.6": "libxext6",
  "libXrender.so.1": "libxrender1",
  "libXi.so.6": "libxi6",
  "libXtst.so.6": "libxtst6",
  "libexpat.so.1": "libexpat1",
  "libuuid.so.1": "libuuid1",
  "libwayland-client.so.0": "libwayland-client0",
  "libwayland-server.so.0": "libwayland-server0",
};

/**
 * `ldd` reports some sonames capitalised (`libXcomposite.so.1`) and others not
 * (`libatk-1.0.so.0`), so look providers up case-insensitively.
 */
const PROVIDERS_BY_SONAME = new Map(
  Object.entries(PROVIDERS).map(([soname, packageName]) => [soname.toLowerCase(), packageName]),
);

const providerFor = (soname) => PROVIDERS_BY_SONAME.get(soname.toLowerCase());

/** Resolved once per run: every package the archive index knows about. */
const index = new Map();

function log(message) {
  process.stdout.write(`${message}\n`);
}

function parsePackageIndex(text, suite) {
  for (const stanza of text.split("\n\n")) {
    const field = (name) => {
      const match = new RegExp(`^${name}: (.*)$`, "m").exec(stanza);
      return match ? match[1].trim() : undefined;
    };

    const name = field("Package");
    const filename = field("Filename");
    if (!name || !filename) continue;

    // Prefer the first entry seen (base suite before -updates).
    if (!index.has(name)) {
      index.set(name, {
        name,
        version: field("Version") ?? "",
        filename,
        depends: field("Depends") ?? "",
        suite,
      });
    }
  }
}

function fetchIndexes() {
  for (const { suite, component } of INDEXES) {
    const url = `${ARCHIVE}/dists/${suite}/${component}/binary-amd64/Packages.gz`;
    try {
      const response = execFileSync("curl", ["-sSL", "--max-time", "120", url], {
        maxBuffer: 64 * 1024 * 1024,
      });
      parsePackageIndex(gunzipSync(response).toString("utf8"), suite);
    } catch (error) {
      process.stderr.write(`warning: could not read ${url}: ${String(error)}\n`);
    }
  }
  log(`  archive index: ${index.size} packages`);
}

const installedCache = new Map();

function isInstalled(packageName) {
  if (installedCache.has(packageName)) return installedCache.get(packageName);
  let installed = false;
  try {
    const status = execFileSync("dpkg", ["-s", packageName], {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
    installed = /Status: install ok installed/.test(status);
  } catch {
    installed = false;
  }
  installedCache.set(packageName, installed);
  return installed;
}

/** `ldd` on the browser binary with our extracted libs already on the path. */
function missingLibraries(binary) {
  const output = execFileSync("/usr/bin/ldd", [binary], {
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, LD_LIBRARY_PATH: existingLibPath() },
  }).toString("utf8");

  return [
    ...new Set(
      output
        .split("\n")
        .filter((line) => line.includes("not found"))
        .map((line) => line.trim().split(" ")[0])
        .filter(Boolean),
    ),
  ];
}

function existingLibPath() {
  const parts = [];
  if (existsSync(LIB_DIR)) parts.push(LIB_DIR);
  if (process.env.LD_LIBRARY_PATH) parts.push(process.env.LD_LIBRARY_PATH);
  return parts.join(":");
}

function dependencyNames(depends) {
  if (!depends) return [];
  return depends
    .split(",")
    .map((entry) => entry.trim().split("|")[0]?.trim() ?? "")
    .map((entry) => entry.replace(/\s*\(.*\)$/, "").trim())
    .filter((entry) => entry.length > 0);
}

function download(packageName) {
  const entry = index.get(packageName);
  if (!entry) {
    process.stderr.write(`  ! ${packageName} is not in the archive index\n`);
    return false;
  }

  const debPath = join(CACHE_DIR, `${packageName}.deb`);
  if (!existsSync(debPath)) {
    const url = `${ARCHIVE}/${entry.filename}`;
    execFileSync("curl", ["-sSL", "--fail", "--max-time", "180", "-o", debPath, url], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  execFileSync("dpkg-deb", ["-x", debPath, DEPS_DIR], { stdio: ["ignore", "ignore", "pipe"] });
  return true;
}

function main() {
  const printPathOnly = process.argv.includes("--print-path");
  if (printPathOnly) {
    process.stdout.write(`${LIB_DIR}\n`);
    return;
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  const binary = chromium.executablePath();
  if (!existsSync(binary)) {
    process.stderr.write(
      "Chromium is not installed yet. Run: pnpm exec playwright install chromium\n",
    );
    process.exit(1);
  }
  log(`browser: ${binary}`);

  let missing = missingLibraries(binary);
  if (missing.length === 0) {
    log("all shared libraries already resolve — nothing to fetch");
    return;
  }

  log(`missing libraries: ${missing.join(", ")}`);
  fetchIndexes();

  const queue = [];
  const seen = new Set();

  const enqueue = (packageName) => {
    if (!packageName || seen.has(packageName)) return;
    seen.add(packageName);
    if (isInstalled(packageName)) return;
    queue.push(packageName);
  };

  for (const soname of missing) {
    const provider = providerFor(soname);
    if (!provider) {
      process.stderr.write(`  ! no known provider for ${soname}\n`);
      continue;
    }
    enqueue(provider);
  }

  // Walk the dependency closure, then extract. Newly extracted libraries can
  // reveal further missing sonames, so verify and repeat (bounded).
  for (let round = 0; round < 4; round += 1) {
    while (queue.length > 0) {
      const packageName = queue.shift();
      if (!packageName) continue;

      if (download(packageName)) {
        log(`  + ${packageName}`);
        for (const dependency of dependencyNames(index.get(packageName)?.depends ?? "")) {
          // Never shadow the system C library: mixing glibc builds breaks Chromium.
          if (dependency.startsWith("libc6") || dependency === "libc6") continue;
          enqueue(dependency);
        }
      }
    }

    missing = missingLibraries(binary);
    if (missing.length === 0) break;

    log(`still missing: ${missing.join(", ")}`);
    for (const soname of missing) enqueue(providerFor(soname));
  }

  if (missing.length > 0) {
    process.stderr.write(
      `\nStill unresolved: ${missing.join(", ")}\n` +
        "Add the sonames to PROVIDERS in this script, or install the system packages:\n" +
        "  sudo pnpm exec playwright install-deps chromium\n",
    );
    process.exit(1);
  }

  log(`\nready — run the capture with:\n  LD_LIBRARY_PATH="${LIB_DIR}" pnpm run screenshots`);
}

main();
