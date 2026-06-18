// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * auto-index.ts
 *
 * Fully automated pipeline: discover new repos → geocode + scan → write to DB.
 *
 *   Step 1 — GitHub Search API fetches trending repos not yet in badge_cache.
 *   Step 2 — batch-scan.ts fetches stargazers + geocodes + writes stargazer_cache,
 *             badge_cache, github_user, star_event.
 *
 * Usage:
 *   pnpm auto-index                   # prod (Neon), 100 repos, 500+ stars
 *   pnpm auto-index:local             # local Docker Postgres (sync to Neon after)
 *   pnpm auto-index -- --limit 50 --min-stars 1000
 *
 * Options:
 *   --limit <N>          Max repos to scan in this run (default: 100)
 *   --min-stars <N>      Minimum star count to include (default: 500)
 *   --since-months <N>   Repos pushed in the last N months (default: 12)
 *   --local              Use DATABASE_URL_LOCAL — local Docker Postgres
 *   --dry-run            Discovery preview only — no writes, no scan
 *   --skip-geocoding     Fetch stargazers only, skip geocoding step
 *   --force              Rescan even if already in stargazer_cache (delta by default)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";

// ─── Load .env.local ──────────────────────────────────────────────────────────

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: argv } = parseArgs({
  options: {
    "limit":          { type: "string",  default: "100" },
    "min-stars":      { type: "string",  default: "500" },
    "since-months":   { type: "string",  default: "12" },
    "local":          { type: "boolean", default: false },
    "dry-run":        { type: "boolean", default: false },
    "skip-geocoding": { type: "boolean", default: false },
    "force":          { type: "boolean", default: false },
  },
  strict: true,
});

const LIMIT          = Math.max(1, parseInt(argv.limit ?? "100", 10));
const MIN_STARS      = parseInt(argv["min-stars"] ?? "500", 10);
const SINCE_MONTHS   = parseInt(argv["since-months"] ?? "12", 10);
const USE_LOCAL      = argv.local;
const DRY_RUN        = argv["dry-run"];
const SKIP_GEOCODING = argv["skip-geocoding"];
const FORCE          = argv.force;

// ─── DB validation ────────────────────────────────────────────────────────────

const NEON_URL  = process.env.DATABASE_URL ?? "";
const LOCAL_URL = process.env.DATABASE_URL_LOCAL ?? "";

if (USE_LOCAL && !LOCAL_URL) {
  console.error("Error: DATABASE_URL_LOCAL not set in .env.local");
  console.error("  Add: DATABASE_URL_LOCAL=postgresql://starmapper:starmapper@localhost:5433/starmapper");
  process.exit(1);
}

if (!USE_LOCAL && !NEON_URL) {
  console.error("Error: DATABASE_URL not set in .env.local");
  console.error("  Tip: use --local to target Docker Postgres via DATABASE_URL_LOCAL");
  process.exit(1);
}

// collect-trending-repos.ts uses DATABASE_URL — override it when targeting local.
const collectEnv: NodeJS.ProcessEnv = USE_LOCAL
  ? { ...process.env, DATABASE_URL: LOCAL_URL }
  : process.env;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TSX = join(process.cwd(), "node_modules/.bin/tsx");

const run = (args: string[], env: NodeJS.ProcessEnv) => {
  const result = spawnSync(TSX, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Process exited with code ${result.status ?? "?"}`);
  }
};

const separator = (label: string) =>
  console.log(`\n${"─".repeat(60)}\n  ${label}\n${"─".repeat(60)}`);

// ─── Temp file ────────────────────────────────────────────────────────────────

const TMP = join(process.cwd(), `scripts/repos-auto-tmp-${process.pid}.json`);

const cleanup = () => {
  if (existsSync(TMP)) {
    try { unlinkSync(TMP); } catch { /* ignore */ }
  }
};
process.on("exit", cleanup);
process.on("SIGINT",  () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const dbLabel = USE_LOCAL ? "local Docker" : "Neon prod";

  console.log("StarMapper Auto-Index");
  console.log(`  Limit:        ${LIMIT} repos`);
  console.log(`  Min stars:    ${MIN_STARS}`);
  console.log(`  Since months: ${SINCE_MONTHS}`);
  console.log(`  DB target:    ${dbLabel}`);
  console.log(`  Dry run:      ${DRY_RUN}`);

  // ─── Step 1: Discover new repos ──────────────────────────────────────────────

  separator("Step 1 / 2 — Discover new repos (GitHub Search API)");

  const collectArgs = [
    "scripts/ops/collect-trending-repos.ts",
    "--output", TMP,
    "--min-stars", String(MIN_STARS),
    "--since-months", String(SINCE_MONTHS),
    ...(DRY_RUN ? ["--dry-run"] : []),
  ];

  run(collectArgs, collectEnv);

  if (DRY_RUN) {
    console.log("\nDry run — stopping after discovery. No scan launched.");
    process.exit(0);
  }

  // ─── Step 1b: Read + limit ───────────────────────────────────────────────────

  let repos: string[];
  try {
    repos = JSON.parse(readFileSync(TMP, "utf8")) as string[];
  } catch {
    console.error("Error: collect-trending-repos.ts did not produce a valid JSON output.");
    process.exit(1);
  }

  if (repos.length === 0) {
    console.log("\nNo new repos found — all trending repos are already indexed.");
    process.exit(0);
  }

  const limited = repos.slice(0, LIMIT);

  console.log(`\nNew repos discovered: ${repos.length}`);
  if (limited.length < repos.length) {
    console.log(`Limiting to first ${limited.length} (--limit ${LIMIT})`);
  }
  console.log("\nQueue:");
  for (const r of limited) {
    console.log(`  ${r}`);
  }

  writeFileSync(TMP, JSON.stringify(limited, null, 2));

  // ─── Step 2: Batch scan ───────────────────────────────────────────────────────

  separator(`Step 2 / 2 — Scan ${limited.length} repos`);

  const scanArgs = [
    "scripts/ops/batch-scan.ts",
    "--input", TMP,
    // Local Docker: use --local flag (reads DATABASE_URL_LOCAL).
    // Neon: use --allow-neon explicitly to bypass the production safety guard.
    ...(USE_LOCAL ? ["--local"] : ["--allow-neon"]),
    ...(FORCE          ? ["--force"]          : []),
    ...(SKIP_GEOCODING ? ["--skip-geocoding"] : []),
  ];

  run(scanArgs, process.env);

  // ─── Done ─────────────────────────────────────────────────────────────────────

  separator("Done");
  console.log(`Scanned ${limited.length} repos on ${dbLabel}.`);

  if (USE_LOCAL) {
    console.log("\nLocal DB updated. To sync to Neon production:");
    console.log("  make db-sync-to-prod");
  }
};

main().catch((err: unknown) => {
  console.error("\nFatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
