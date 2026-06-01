// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * backfill-repo-languages.ts
 *
 * Fetches the primary language for each repo in badge_cache where language IS NULL,
 * using the GitHub REST API (GET /repos/{owner}/{repo}).
 *
 * Usage:
 *   pnpm backfill:repo-languages            # local Docker DB
 *   pnpm backfill:repo-languages --prod     # Neon prod
 *   pnpm backfill:repo-languages --dry-run  # preview, no writes
 *
 * Rate limit: ~200ms between calls → ~1169 repos ≈ 4 min with auth token.
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

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
    "dry-run": { type: "boolean", default: false },
    "prod":    { type: "boolean", default: false },
  },
  strict: true,
});
const DRY_RUN  = argv["dry-run"];
const USE_PROD = argv.prod;

const DB_URL = USE_PROD
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) { console.error("Error: no DB URL found"); process.exit(1); }

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) { console.error("Error: GITHUB_TOKEN not set"); process.exit(1); }

// ─── Prisma setup ─────────────────────────────────────────────────────────────

const prisma = USE_PROD
  ? new PrismaClient({ adapter: new PrismaNeon({ connectionString: DB_URL }) })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: DB_URL, options: "-c statement_timeout=0" })) });

// ─── GitHub REST ──────────────────────────────────────────────────────────────

const fetchRepoLanguage = async (owner: string, repo: string): Promise<string | null> => {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "starmapper-backfill/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) return null; // repo deleted/private
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    const waitMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 2000 : 60_000;
    console.warn(`  [rate-limit] waiting ${Math.round(waitMs / 1000)}s…`);
    await new Promise<void>((r) => setTimeout(r, waitMs));
    return fetchRepoLanguage(owner, repo); // retry once
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status} for ${owner}/${repo}`);

  const data = await res.json() as { language?: string | null };
  return data.language ?? null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log("\nBackfill badge_cache.language from GitHub REST API");
  console.log(`  DB:      ${USE_PROD ? "Neon prod" : "local Docker"}`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  const repos = await prisma.badgeCache.findMany({
    where: { language: null },
    orderBy: { updatedAt: "desc" },
    select: { owner: true, repo: true },
  });

  console.log(`Repos to process: ${repos.length}\n`);
  if (repos.length === 0) { console.log("Nothing to do."); await prisma.$disconnect(); return; }

  let updated = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < repos.length; i++) {
    const { owner, repo } = repos[i];

    try {
      const language = await fetchRepoLanguage(owner, repo);

      if (!DRY_RUN) {
        await prisma.badgeCache.update({
          where: { owner_repo: { owner, repo } },
          // Store null explicitly so the row is not retried even when repo has no language
          data: { language: language ?? "" },
        });
      }

      if (language) {
        updated++;
        console.log(`  [${i + 1}/${repos.length}] ${owner}/${repo} → ${language}`);
      } else {
        skipped++;
        if (DRY_RUN) console.log(`  [${i + 1}/${repos.length}] ${owner}/${repo} → (no language)`);
      }
    } catch (err) {
      console.error(`  [error] ${owner}/${repo}:`, (err as Error).message);
    }

    // Progress log every 50 repos
    if ((i + 1) % 50 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const eta = Math.round(((repos.length - i - 1) * (elapsed / (i + 1))));
      console.log(`\n  ── ${i + 1}/${repos.length} done — ${elapsed}s elapsed — ETA ~${eta}s ──\n`);
    }

    await sleep(200); // ~300 req/min, well under 5000/hr limit
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone — ${updated} languages set, ${skipped} repos with no language, in ${elapsed}s`);

  await prisma.$disconnect();
};

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
