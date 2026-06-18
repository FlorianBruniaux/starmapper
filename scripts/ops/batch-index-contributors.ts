// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * batch-index-contributors.ts
 *
 * Pre-warms the geocache for contributors of all indexed repos in StargazerCache.
 * Calls fetchContributorsPage + fetchContributorLocations + geocodeBatch directly
 * — no HTTP server needed. Geocache writes go to the local DB, then synced to Neon
 * as part of the maintenance pipeline.
 *
 * Usage:
 *   make batch-index-contributors                   # all repos >= 100 stars, local DB
 *   make batch-index-contributors-prod              # Neon prod DB
 *   pnpm batch:contributors -- --dry-run            # preview without indexing
 *   pnpm batch:contributors -- --min-stars 500      # only repos with >= 500 stars
 *   pnpm batch:contributors -- --repos owner/repo,owner2/repo2  # specific repos
 *
 * Flags:
 *   --min-stars <n>    Min star count to include (default: 100)
 *   --limit <n>        Max repos to process (for testing)
 *   --repos <csv>      Comma-separated owner/repo list — bypass DB query
 *   --dry-run          Print target list without indexing
 *   --prod             Use Neon prod DB (default: local Docker)
 *   --gh-token <tok>   Force a single GitHub PAT
 *
 * Multi-token: set GITHUB_TOKEN, GITHUB_TOKEN_2, GITHUB_TOKEN_3… in .env.local
 * for automatic rotation. On GitHub 429, the exhausted token is parked until
 * its resetAt and the next available token is used immediately.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  fetchContributorsPage,
  fetchContributorLocations,
  GitHubRateLimitError,
} from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    "min-stars": { type: "string",  default: "100" },
    "limit":     { type: "string" },
    "repos":     { type: "string" },
    "dry-run":   { type: "boolean", default: false },
    "prod":      { type: "boolean", default: false },
    "gh-token":  { type: "string" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const minStars       = parseInt(values["min-stars"] as string, 10);
const limit          = values["limit"] ? parseInt(values["limit"] as string, 10) : undefined;
const reposFilter    = values["repos"] ? (values["repos"] as string).split(",").map((r) => r.trim()).filter(Boolean) : null;
const dryRun         = values["dry-run"] as boolean;
const useProd        = values["prod"] as boolean;
const ghTokenOverride = values["gh-token"] as string | undefined;

const DB_URL = useProd
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) {
  console.error("Error: no DB URL found (DATABASE_URL_LOCAL or DATABASE_URL)");
  process.exit(1);
}

// ─── Prisma ───────────────────────────────────────────────────────────────────

const pool   = new pg.Pool({ connectionString: DB_URL, options: "-c statement_timeout=0" });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Multi-token pool ─────────────────────────────────────────────────────────

type TokenState = { token: string; exhaustedUntil: number };

const buildTokenPool = (): TokenState[] => {
  if (ghTokenOverride) return [{ token: ghTokenOverride, exhaustedUntil: 0 }];
  const tokens: string[] = [];
  if (process.env.GITHUB_TOKEN) tokens.push(process.env.GITHUB_TOKEN);
  let i = 2;
  while (true) {
    const t = process.env[`GITHUB_TOKEN_${i}`];
    if (!t) break;
    tokens.push(t);
    i++;
  }
  return tokens.map((token) => ({ token, exhaustedUntil: 0 }));
};

const TOKEN_POOL = buildTokenPool();

const acquireToken = async (): Promise<TokenState | null> => {
  if (TOKEN_POOL.length === 0) return null;
  const now = Date.now();
  const available = TOKEN_POOL.find((t) => t.exhaustedUntil <= now);
  if (available) return available;

  const earliest = TOKEN_POOL.reduce((min, t) => (t.exhaustedUntil < min.exhaustedUntil ? t : min));
  const waitMs   = Math.max(0, earliest.exhaustedUntil - Date.now()) + 2_000;
  const waitMin  = Math.ceil(waitMs / 60_000);
  process.stdout.write(`\n  [token-pool] All ${TOKEN_POOL.length} tokens exhausted — waiting ${waitMin}min\n`);
  await new Promise((r) => setTimeout(r, waitMs));
  earliest.exhaustedUntil = 0;
  return earliest;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

const COMPUTING_WAIT_MS = 30_000;
const MAX_COMPUTING_RETRIES = 6;

// ─── Per-repo chunk loop ──────────────────────────────────────────────────────

type RepoResult = { mapped: number; unmapped: number; pages: number; ok: boolean };

const indexRepoContributors = async (owner: string, repo: string): Promise<RepoResult> => {
  let page = 1;
  let mapped   = 0;
  let unmapped = 0;
  let pagesDone = 0;
  let computingRetries = 0;

  while (page <= 5) {
    const tok   = await acquireToken();
    const token = tok?.token;

    let result: Awaited<ReturnType<typeof fetchContributorsPage>>;
    try {
      result = await fetchContributorsPage(owner, repo, page, token);
    } catch (err) {
      if (err instanceof GitHubRateLimitError) {
        if (tok) {
          tok.exhaustedUntil = err.resetAt + 2_000;
          const avail = TOKEN_POOL.filter((t) => t.exhaustedUntil <= Date.now()).length;
          process.stdout.write(`\n    GitHub rate limited — token parked (${avail}/${TOKEN_POOL.length} available)\n`);
        }
        continue; // retry same page with next token
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Page ${page} error: ${msg}`);
      return { mapped, unmapped, pages: pagesDone, ok: false };
    }

    // GitHub still computing stats — wait and retry
    if (result.computing) {
      computingRetries++;
      if (computingRetries > MAX_COMPUTING_RETRIES) {
        console.error(`    GitHub still computing after ${MAX_COMPUTING_RETRIES} retries — skipping`);
        return { mapped, unmapped, pages: pagesDone, ok: false };
      }
      const waitSec = Math.ceil(COMPUTING_WAIT_MS / 1000);
      process.stdout.write(`    Computing... retry ${computingRetries}/${MAX_COMPUTING_RETRIES} in ${waitSec}s\n`);
      await new Promise((r) => setTimeout(r, COMPUTING_WAIT_MS));
      continue;
    }
    computingRetries = 0;

    if (result.contributors.length === 0) break;

    // Fetch locations for all contributors in this page (GitHub API doesn't include location)
    const logins = result.contributors.map((c) => c.login);
    let locationMap = new Map<string, string | null>();
    try {
      locationMap = await fetchContributorLocations(logins, token);
    } catch (err) {
      if (err instanceof GitHubRateLimitError && tok) {
        tok.exhaustedUntil = err.resetAt + 2_000;
      }
      // Non-fatal: skip geocoding for this page, count as unmapped
      process.stdout.write(`    Locations fetch failed for page ${page}, skipping geocoding\n`);
    }

    // Collect non-empty raw locations
    const locationsToGeocode = logins
      .map((login) => locationMap.get(login) ?? null)
      .filter((loc): loc is string => !!loc);

    const geoMap = locationsToGeocode.length > 0
      ? await geocodeBatch(locationsToGeocode)
      : new Map<string, [number, number] | null>();

    let pts = 0;
    let unm = 0;
    for (const c of result.contributors) {
      const loc    = locationMap.get(c.login) ?? null;
      const coords = loc ? (geoMap.get(loc) ?? null) : null;
      if (coords) pts++;
      else unm++;
    }

    mapped   += pts;
    unmapped += unm;
    pagesDone++;

    process.stdout.write(
      `    Page ${page}: ${result.contributors.length} contributors, +${pts} mapped, +${unm} unmapped\n`,
    );

    if (!result.hasMore) break;
    page++;
  }

  return { mapped, unmapped, pages: pagesDone, ok: true };
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const startMs = Date.now();

  let repos: { owner: string; repo: string; totalCount: number }[];

  if (reposFilter && reposFilter.length > 0) {
    repos = reposFilter.map((r) => {
      const [owner, repo] = r.split("/") as [string, string];
      return { owner, repo, totalCount: 0 };
    });
    console.log(`Direct mode: indexing contributors for ${repos.map((r) => `${r.owner}/${r.repo}`).join(", ")}`);
  } else {
    repos = await prisma.stargazerCache.findMany({
      where:   { totalCount: { gte: minStars } },
      select:  { owner: true, repo: true, totalCount: true },
      orderBy: { totalCount: "desc" },
      ...(limit !== undefined ? { take: limit } : {}),
    });
    const filterDesc = minStars > 0 ? ` with >= ${minStars} stars` : "";
    console.log(`Found ${repos.length} repos${filterDesc} (ordered by stars desc)`);
  }

  if (dryRun) {
    console.log("\nDry run — would index:\n");
    repos.forEach((r, i) => {
      console.log(`  ${String(i + 1).padStart(4)}. ${r.owner}/${r.repo} (${fmtCount(r.totalCount)} stars)`);
    });
    console.log("\nRun without --dry-run to start indexing.");
    await prisma.$disconnect();
    return;
  }

  if (TOKEN_POOL.length > 0) {
    console.log(`GitHub tokens: ${TOKEN_POOL.length} (rotation ${TOKEN_POOL.length > 1 ? "enabled" : "disabled"})`);
  } else {
    console.log("No GitHub token — rate limited to 60 req/hr.");
  }
  console.log(`DB: ${useProd ? "Neon prod" : "local Docker"}`);
  console.log(`Repos to process: ${repos.length}\n`);

  let totalMapped   = 0;
  let totalUnmapped = 0;
  let totalErrors   = 0;

  for (let i = 0; i < repos.length; i++) {
    const r = repos[i];
    if (!r) continue;
    console.log(`\n[${i + 1}/${repos.length}] ${r.owner}/${r.repo} (${fmtCount(r.totalCount)} stars)`);

    const result = await indexRepoContributors(r.owner, r.repo);

    const pct = result.mapped + result.unmapped > 0
      ? Math.round((result.mapped * 100) / (result.mapped + result.unmapped))
      : 0;

    console.log(
      `  Done: ${result.mapped} mapped (${pct}%), ${result.unmapped} unmapped` +
      (result.ok ? "" : " [ERROR]"),
    );

    totalMapped   += result.mapped;
    totalUnmapped += result.unmapped;
    if (!result.ok) totalErrors++;
  }

  const elapsed = Math.round((Date.now() - startMs) / 1000);
  const totalPct = totalMapped + totalUnmapped > 0
    ? Math.round((totalMapped * 100) / (totalMapped + totalUnmapped))
    : 0;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Batch complete in ${elapsed}s`);
  console.log(`  Repos processed : ${repos.length - totalErrors} / ${repos.length}`);
  console.log(`  Errors          : ${totalErrors}`);
  console.log(`  Total mapped    : ${totalMapped} (${totalPct}%)`);
  console.log(`  Total unmapped  : ${totalUnmapped}`);
  console.log(`\nGeocache is now warm. Run 'make maintenance --skip-backfills' to sync to Neon.`);

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
