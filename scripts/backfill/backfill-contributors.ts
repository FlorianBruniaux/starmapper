// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Fills contributorsCount in badge_cache using the GitHub contributors endpoint
// (per_page=1 + Link header last-page technique). Handles 202 with retry.
//
// Usage:
//   pnpm backfill:contributors:local [options]
//   pnpm backfill:contributors:prod  [options]
//
// Options:
//   --dry-run        Preview only, no DB writes (default: false)
//   --force          Re-fetch even if contributorsCount is already set
//   --limit=N        Process at most N repos (useful for smoke-testing)
//   --delay=N        ms between GitHub fetches per worker (default: 800)
//   --concurrency=N  Parallel workers (default: 3, max 5 to stay well under 5k/hr)

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { acquireToken, buildTokenPool, makeHeaders, syncTokenFromHeaders } from "../lib/github-token-pool";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: argv } = parseArgs({
  options: {
    "dry-run":     { type: "boolean", default: false },
    "force":       { type: "boolean", default: false },
    "limit":       { type: "string" },
    "delay":       { type: "string", default: "800" },
    "concurrency": { type: "string", default: "3" },
  },
  strict: true,
  args: process.argv.slice(2).filter((a) => a !== "--"),
});

const DRY_RUN     = argv["dry-run"];
const FORCE       = argv["force"];
const LIMIT       = argv["limit"]       ? parseInt(argv["limit"],       10) : null;
const DELAY_MS    = parseInt(argv["delay"]!,       10);
const CONCURRENCY = Math.min(parseInt(argv["concurrency"]!, 10), 5);

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── GitHub fetch ──────────────────────────────────────────────────────────────

const TOKEN_POOL = buildTokenPool();

/**
 * Fetch contributors count for owner/repo.
 * Uses per_page=1 + Link header "last" page number for efficiency.
 * Retries once on 202 (GitHub computing stats asynchronously).
 * Returns null on 202 after retries, 403, or network error.
 */
const fetchContributorsCount = async (
  owner: string,
  repo: string,
  retries = 2,
): Promise<number | null> => {
  const url = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=0`;
  try {
    const tok = await acquireToken(TOKEN_POOL);
    const res = await fetch(url, { headers: makeHeaders(tok, { Accept: "application/vnd.github.v3+json" }) });
    syncTokenFromHeaders(tok, res);

    if (res.status === 202) {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, 3000));
        return fetchContributorsCount(owner, repo, retries - 1);
      }
      return null; // still computing — skip, will be picked up on next run
    }

    if (res.status === 403 || res.status === 429) {
      // 403 is ambiguous: real quota exhaustion (x-ratelimit-remaining: 0) vs the
      // "contributor list too large" forbidden that huge repos (torvalds/linux) return.
      // Real quota → park the token and rotate (acquireToken waits for reset if all are
      // spent); the "too large" 403 never succeeds, so skip it immediately.
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0" || res.status === 429) {
        tok.remaining = 0;
        return fetchContributorsCount(owner, repo, retries);
      }
      console.warn(`[skip] ${owner}/${repo} — 403 (contributor list too large)`);
      return null;
    }

    if (res.status === 404 || res.status === 410) return null; // deleted / moved

    if (!res.ok) {
      console.warn(`[skip] ${owner}/${repo} — HTTP ${res.status}`);
      return null;
    }

    // Link header present → use last-page number
    const link = res.headers.get("link");
    if (link) {
      const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (match) return parseInt(match[1], 10);
      return 1; // Link present but no "last" = single page of results
    }

    // No Link header → parse array and return its length (small repo)
    const items = await res.json() as unknown[];
    return Array.isArray(items) ? items.length : null;
  } catch {
    console.warn(`[skip] ${owner}/${repo} — network error`);
    return null;
  }
};

// ─── Main loop ─────────────────────────────────────────────────────────────────

type WorkItem = { owner: string; repo: string; totalCount: number };

const processOne = async (item: WorkItem): Promise<"updated" | "skipped" | "computing"> => {
  const { owner, repo } = item;
  const count = await fetchContributorsCount(owner, repo);

  if (count === null) return "computing"; // 202 or error — skip without writing null

  if (!DRY_RUN) {
    await prisma.badgeCache.update({
      where: { owner_repo: { owner, repo } },
      data: { contributorsCount: count },
    });
  }

  console.log(`[${DRY_RUN ? "dry" : "ok"}] ${owner}/${repo} — contributors=${count}`);
  return "updated";
};

const runBatch = async (items: WorkItem[]): Promise<void> => {
  const results = { updated: 0, skipped: 0, computing: 0 };
  let i = 0;

  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx]!;
      const outcome = await processOne(item);
      results[outcome]++;
      if (DELAY_MS > 0 && i < items.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone — updated=${results.updated} computing=${results.computing} skipped=${results.skipped}`);
};

const main = async () => {
  const flags = [DRY_RUN && "dry-run", FORCE && "force", LIMIT && `limit=${LIMIT}`].filter(Boolean).join(", ");
  console.log(`Backfill contributors${flags ? ` (${flags})` : ""} — concurrency=${CONCURRENCY} delay=${DELAY_MS}ms`);

  const rows = await prisma.badgeCache.findMany({
    where: FORCE ? {} : { contributorsCount: null },
    select: { owner: true, repo: true, totalCount: true },
    orderBy: { totalCount: "desc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Found ${rows.length} badge_cache rows to process`);
  if (rows.length === 0) { console.log("Nothing to do."); return; }

  await runBatch(rows);
};

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
