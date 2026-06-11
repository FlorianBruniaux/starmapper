// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * seed-trending-watchlist.ts
 *
 * Seeds the trending_watchlist table from the curated list in
 * src/lib/trending-watchlist-seed.ts. Idempotent (skipDuplicates).
 *
 * Usage:
 *   pnpm tsx scripts/db/seed-trending-watchlist.ts [--dry-run]
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { TRENDING_WATCHLIST_SEED } from "@/lib/trending-watchlist-seed";

// Scripts never use the @/lib/db singleton (it require()s pg, which breaks under
// tsx's native ESM). Same pattern as every other script in scripts/ — own PrismaClient.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
  args: process.argv.slice(2),
});

const dryRun = values["dry-run"];

const main = async () => {
  const entries = TRENDING_WATCHLIST_SEED;
  console.log(`Seeding trending_watchlist (dry-run: ${dryRun}) — ${entries.length} curated repos`);

  const existing = await prisma.trendingWatchlist.findMany({ select: { owner: true, repo: true } });
  const existingSet = new Set(existing.map((e) => `${e.owner}/${e.repo}`));
  const toAdd = entries.filter((e) => !existingSet.has(`${e.owner}/${e.repo}`));

  console.log(`Already present: ${existingSet.size} · New to insert: ${toAdd.length}`);

  if (dryRun) {
    toAdd.forEach((e) => console.log(`[dry-run] would insert ${e.owner}/${e.repo}`));
    console.log("Done (dry-run, no writes).");
    return;
  }

  if (toAdd.length > 0) {
    const result = await prisma.trendingWatchlist.createMany({
      data: toAdd.map((e) => ({ owner: e.owner, repo: e.repo })),
      skipDuplicates: true,
    });
    console.log(`Inserted ${result.count} watchlist entries.`);
  } else {
    console.log("Nothing to insert — watchlist already up to date.");
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
