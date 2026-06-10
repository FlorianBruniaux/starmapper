// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Backfill dependents_cache for every repo in badge_cache.
// Fetches dependent repos from ecosyste.ms and stores compressed JSON.
// Repos with no published package get an empty result stored (avoids re-fetching).
//
// Local:  pnpm backfill:dependents
// Prod:   pnpm backfill:dependents:prod
//
// Options:
//   --dry-run        Print what would be fetched without writing
//   --force          Re-fetch even if dependents_cache row is fresh (< 7d)
//   --limit N        Process at most N repos (default: all)
//   --delay-ms N     Pause between repos in ms (default: 600)
//   --min-stars N    Skip repos with fewer than N stars (default: 0)

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { fetchDependents } from "../../src/lib/dependents";
import { compressToGzBase64 } from "../../src/lib/compression";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const DRY_RUN   = process.argv.includes("--dry-run");
const FORCE     = process.argv.includes("--force");

const limitArg  = process.argv.indexOf("--limit");
const LIMIT     = limitArg  !== -1 ? parseInt(process.argv[limitArg  + 1] ?? "999999", 10) : 999999;

const delayArg  = process.argv.indexOf("--delay-ms");
const DELAY_MS  = delayArg  !== -1 ? parseInt(process.argv[delayArg  + 1] ?? "600", 10) : 600;

const starsArg  = process.argv.indexOf("--min-stars");
const MIN_STARS = starsArg  !== -1 ? parseInt(process.argv[starsArg  + 1] ?? "0",   10) : 0;

const STALE_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days — matches expiresAt TTL

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c statement_timeout=0",
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  // Load repos to process from badge_cache, biggest first
  const repos = await prisma.badgeCache.findMany({
    where: { totalCount: { gte: MIN_STARS } },
    select: { owner: true, repo: true, totalCount: true },
    orderBy: { totalCount: "desc" },
    take: LIMIT,
  });

  if (repos.length === 0) {
    console.log("No repos found in badge_cache.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `Found ${repos.length} repos in badge_cache${MIN_STARS > 0 ? ` (>= ${MIN_STARS} stars)` : ""}.`,
  );

  // Load existing dependents_cache rows to skip fresh ones
  const existing = await prisma.dependentsCache.findMany({
    select: { owner: true, repo: true, fetchedAt: true },
  });
  const freshSet = new Set(
    existing
      .filter((r) => Date.now() - r.fetchedAt.getTime() < STALE_MS)
      .map((r) => `${r.owner}/${r.repo}`),
  );

  const toProcess = FORCE
    ? repos
    : repos.filter((r) => !freshSet.has(`${r.owner}/${r.repo}`));

  console.log(
    `${toProcess.length} repos to fetch (${repos.length - toProcess.length} skipped — fresh cache).`,
    DRY_RUN ? "[DRY RUN]" : "",
  );

  let done = 0;
  let noPackage = 0;
  let failed = 0;

  for (const { owner, repo, totalCount } of toProcess) {
    const label = `${owner}/${repo} (${totalCount} stars)`;

    if (DRY_RUN) {
      console.log(`  [DRY] ${label}`);
      done++;
      continue;
    }

    try {
      const result = await fetchDependents(owner, repo);

      if (result.packages.length === 0) {
        // Store empty result to avoid re-hitting ecosyste.ms on every visit
        const dataGz = compressToGzBase64([result]);
        const now = new Date();
        await prisma.dependentsCache.upsert({
          where: { owner_repo: { owner, repo } },
          create: { owner, repo, dataGz, totalCount: 0, fetchedAt: now },
          update: { dataGz, totalCount: 0, fetchedAt: now },
        });
        console.log(`  [NO PKG] ${label}`);
        noPackage++;
      } else {
        const dataGz = compressToGzBase64([result]);
        const now = new Date();
        await prisma.dependentsCache.upsert({
          where: { owner_repo: { owner, repo } },
          create: { owner, repo, dataGz, totalCount: result.totalCount, fetchedAt: now },
          update: { dataGz, totalCount: result.totalCount, fetchedAt: now },
        });
        const pkg = result.packages.map((p) => `${p.name}(${p.ecosystem})`).join(", ");
        console.log(
          `  [OK] ${label} — ${result.dependents.length} dependents via ${pkg}` +
          (result.truncated ? " [truncated]" : ""),
        );
        done++;
      }
    } catch (err) {
      console.error(`  [FAIL] ${label}:`, err instanceof Error ? err.message : err);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. ${done} fetched, ${noPackage} no-package, ${failed} failed, ${repos.length - toProcess.length} skipped.`,
  );
  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
