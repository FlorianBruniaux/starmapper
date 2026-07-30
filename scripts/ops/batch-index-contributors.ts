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
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "../lib/pg-pool";
import {
  fetchContributorsPage,
  fetchContributorLocations,
  GitHubRateLimitError,
} from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    "min-stars": { type: "string",  default: "100" },
    "limit":     { type: "string" },
    "repos":     { type: "string" },
    "dry-run":   { type: "boolean", default: false },
    "prod":      { type: "boolean", default: false },
    "gh-token":  { type: "string" },
    "resume":    { type: "boolean", default: false },
  },
  strict: true,
  args: process.argv.slice(2),
});

const minStars       = parseInt(values["min-stars"] as string, 10);
const limit          = values["limit"] ? parseInt(values["limit"] as string, 10) : undefined;
const reposFilter    = values["repos"] ? (values["repos"] as string).split(",").map((r) => r.trim()).filter(Boolean) : null;
const dryRun          = values["dry-run"] as boolean;
const useProd         = values["prod"] as boolean;
const ghTokenOverride = values["gh-token"] as string | undefined;
const resume          = values["resume"] as boolean;

const CHECKPOINT_PATH = ".contributors-checkpoint.json";

const DB_URL = useProd
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) {
  console.error("Error: no DB URL found (DATABASE_URL_LOCAL or DATABASE_URL)");
  process.exit(1);
}

// ─── Prisma ───────────────────────────────────────────────────────────────────

const pool   = createScriptPool(DB_URL, { options: "-c statement_timeout=0" });
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

// Round-robin index — distributes calls evenly across tokens so concurrent repos
// don't all pile onto TOKEN_POOL[0] and exhaust it first.
let rrIndex = 0;

const acquireToken = async (): Promise<TokenState | null> => {
  if (TOKEN_POOL.length === 0) return null;
  const now = Date.now();

  // Try each token starting from the current round-robin position.
  for (let i = 0; i < TOKEN_POOL.length; i++) {
    const idx = (rrIndex + i) % TOKEN_POOL.length;
    const t = TOKEN_POOL[idx];
    if (t && t.exhaustedUntil <= now) {
      rrIndex = (idx + 1) % TOKEN_POOL.length;
      return t;
    }
  }

  const earliest = TOKEN_POOL.reduce((min, t) => (t.exhaustedUntil < min.exhaustedUntil ? t : min));
  const waitMs   = Math.max(0, earliest.exhaustedUntil - Date.now()) + 2_000;
  const waitMin  = Math.ceil(waitMs / 60_000);
  process.stdout.write(`\n  [token-pool] All ${TOKEN_POOL.length} tokens exhausted — waiting ${waitMin}min\n`);
  await new Promise((r) => setTimeout(r, waitMs));
  earliest.exhaustedUntil = 0;
  rrIndex = (TOKEN_POOL.indexOf(earliest) + 1) % TOKEN_POOL.length;
  return earliest;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

const COMPUTING_WAIT_MS = 30_000;
const MAX_COMPUTING_RETRIES = 6;

// Pause between pages to stay well below GitHub secondary rate limits.
// Secondary limits fire on rapid-fire bursts regardless of hourly quota —
// 1 page = 1 REST + 1 GraphQL call. 1 500ms gap prevents "too many requests
// per second" 429s that are different from the primary 5000pts/hr limit.
const PAGE_DELAY_MS = 1_500;

// Proactively park a token before it hits 429 — avoids burning the request
// on a doomed call. The reset time is unknown without a failed request, so
// we use 1h from now (conservative). The token becomes available again once
// acquireToken() finds a better option.
const LOW_QUOTA_THRESHOLD = 150;

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

    // Proactively park token if quota is low — avoids burning a doomed REST call.
    if (result.quotaRemaining !== null && result.quotaRemaining < LOW_QUOTA_THRESHOLD && tok) {
      tok.exhaustedUntil = Date.now() + 3_600_000; // conservative 1h; reset when a fresh token arrives
      const avail = TOKEN_POOL.filter((t) => t.exhaustedUntil <= Date.now()).length;
      process.stdout.write(`\n    Low quota (${result.quotaRemaining} remaining) — token parked (${avail}/${TOKEN_POOL.length} available)\n`);
    }

    const logins = result.contributors.map((c) => c.login);

    // Pre-check github_user — skip GitHub API for logins we already have coords for.
    // With 6.8M users locally, 40-60% of top-repo contributors are likely stargazers
    // we've already geocoded → skip both GraphQL + Nominatim for them.
    const knownUsers = await bulkReadUsers(logins);
    const unknownLogins = logins.filter((l) => {
      const u = knownUsers.get(l);
      return !u || (u.lat === null && u.lng === null && !u.location);
    });
    const skipCount = logins.length - unknownLogins.length;

    // Build location map from DB cache first, then fetch only the unknowns from GitHub.
    let locationMap = new Map<string, string | null>();
    for (const [login, u] of knownUsers.entries()) {
      locationMap.set(login, u.location ?? null);
    }

    if (unknownLogins.length > 0) {
      const locTok = await acquireToken();
      try {
        const fetched = await fetchContributorLocations(unknownLogins, locTok?.token);
        for (const [login, loc] of fetched.entries()) locationMap.set(login, loc);
      } catch (err) {
        if (err instanceof GitHubRateLimitError && locTok) {
          locTok.exhaustedUntil = err.resetAt + 2_000;
          const avail = TOKEN_POOL.filter((t) => t.exhaustedUntil <= Date.now()).length;
          process.stdout.write(`\n    Locations rate limited — token parked (${avail}/${TOKEN_POOL.length} available)\n`);
        }
        process.stdout.write(`    Locations fetch failed for page ${page}, skipping geocoding\n`);
      }
    }

    if (skipCount > 0) {
      process.stdout.write(`    (${skipCount}/${logins.length} already in DB — skipped GitHub)\n`);
    }

    // Inter-page delay — prevents GitHub secondary rate limits ("too many requests
    // per second"). Each page = 2 API calls (REST + GraphQL); bursting all 2008
    // repos back-to-back triggers secondary limits well before the 5000pts/hr cap.
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));

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

  // Load checkpoint — tracks which repos were successfully completed across runs.
  // Written after every batch; read on --resume to skip already-done repos.
  const doneSet = new Set<string>();
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf-8")) as string[];
      for (const r of prev) doneSet.add(r);
    } catch {
      // corrupt checkpoint — ignore, start fresh
    }
  }

  if (resume && doneSet.size > 0) {
    const before = repos.length;
    repos = repos.filter((r) => !doneSet.has(`${r.owner}/${r.repo}`));
    console.log(`Resuming: ${doneSet.size} already done → skipping, ${repos.length} / ${before} remaining`);
  } else if (doneSet.size > 0 && !resume) {
    console.log(`Checkpoint: ${doneSet.size} repos done in a previous run (use --resume to skip them)`);
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

  // Concurrency = number of repos processed in parallel.
  // Default: min(tokens, 2) — conservative to avoid burning hourly quota on dense repos
  // (torvalds/linux type repos have few DB hits, each page costs a full REST+GraphQL call).
  // Override: CONCURRENCY=4 env var for repos with high DB-skip rates.
  const concurrencyEnv = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : undefined;
  const CONCURRENCY = concurrencyEnv ?? Math.min(TOKEN_POOL.length || 1, 2);

  if (TOKEN_POOL.length > 0) {
    console.log(`GitHub tokens: ${TOKEN_POOL.length} (rotation ${TOKEN_POOL.length > 1 ? "enabled" : "disabled"})`);
  } else {
    console.log("No GitHub token — rate limited to 60 req/hr.");
  }
  console.log(`DB: ${useProd ? "Neon prod" : "local Docker"}`);
  console.log(`Repos to process: ${repos.length} (concurrency: ${CONCURRENCY})\n`);

  let totalMapped   = 0;
  let totalUnmapped = 0;
  let totalErrors   = 0;
  let done = 0;

  // Process repos in parallel batches of CONCURRENCY.
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY).filter(Boolean);

    const results = await Promise.all(
      batch.map(async (r, batchIdx) => {
        const globalIdx = i + batchIdx + 1;
        console.log(`\n[${globalIdx}/${repos.length}] ${r.owner}/${r.repo} (${fmtCount(r.totalCount)} stars)`);
        return { r, result: await indexRepoContributors(r.owner, r.repo) };
      }),
    );

    for (const { r, result } of results) {
      const pct = result.mapped + result.unmapped > 0
        ? Math.round((result.mapped * 100) / (result.mapped + result.unmapped))
        : 0;
      console.log(
        `  ${r.owner}/${r.repo}: ${result.mapped} mapped (${pct}%), ${result.unmapped} unmapped` +
        (result.ok ? "" : " [ERROR]"),
      );
      totalMapped   += result.mapped;
      totalUnmapped += result.unmapped;
      if (!result.ok) totalErrors++;
      else doneSet.add(`${r.owner}/${r.repo}`);
      done++;
    }

    // Persist checkpoint after every batch — if the script crashes, next run
    // with --resume skips everything already completed.
    if (!dryRun) {
      try {
        writeFileSync(CHECKPOINT_PATH, JSON.stringify([...doneSet], null, 2));
      } catch {
        // non-fatal — checkpoint is best-effort
      }
    }
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
  console.log(`\nGeocache is now warm. Run 'make maintenance-sync-only' to sync to Neon.`);

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
