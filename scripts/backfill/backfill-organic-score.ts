// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// One-shot: compute organicScore/organicTier for every badge_cache row that has none yet.
// Uses forksCount/watchersCount from badge_cache when available, fetches from GitHub otherwise.
// Also fetches releasesCount from GitHub REST for each repo.
//
// Local:   pnpm backfill:organic-score
// Prod:    pnpm backfill:organic-score:prod
//
// Options:
//   --dry-run   Print what would be updated without writing
//   --limit N   Process at most N repos (default: all)

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { computeOrganicScore } from "../../src/lib/organic-score";
import { acquireToken, buildTokenPool, makeHeaders, syncTokenFromHeaders } from "../lib/github-token-pool";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE   = process.argv.includes("--force");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1] ?? "999999", 10) : 999999;
const TOKEN_POOL = buildTokenPool();
const DELAY_MS = 300;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c statement_timeout=0" });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type RepoGitHubData = {
  forksCount: number;
  watchersCount: number;
  releasesCount: number | null;
};

const fetchReleasesCount = async (owner: string, repo: string): Promise<number | null> => {
  try {
    const tok = await acquireToken(TOKEN_POOL);
    const relRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`,
      { headers: makeHeaders(tok, { Accept: "application/vnd.github.v3+json" }), signal: AbortSignal.timeout(8000) },
    );
    syncTokenFromHeaders(tok, relRes);
    if (!relRes.ok) return null;
    const linkHeader = relRes.headers.get("link") ?? "";
    const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
    if (lastMatch) return parseInt(lastMatch[1], 10);
    const body = await relRes.json() as unknown[];
    return body.length > 0 ? 1 : 0;
  } catch {
    return null;
  }
};

const fetchGitHubData = async (owner: string, repo: string): Promise<RepoGitHubData | null> => {
  try {
    const tok = await acquireToken(TOKEN_POOL);
    const repoRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: makeHeaders(tok, { Accept: "application/vnd.github.v3+json" }), signal: AbortSignal.timeout(8000) },
    );
    syncTokenFromHeaders(tok, repoRes);
    if (!repoRes.ok) return null;
    const repoData = await repoRes.json() as { forks_count: number; subscribers_count: number };
    await sleep(DELAY_MS);

    const releasesCount = await fetchReleasesCount(owner, repo);
    await sleep(DELAY_MS);

    return {
      forksCount: repoData.forks_count,
      watchersCount: repoData.subscribers_count,
      releasesCount,
    };
  } catch {
    return null;
  }
};

const main = async () => {
  const rows = await prisma.badgeCache.findMany({
    where: FORCE ? { totalCount: { gt: 0 } } : { organicTier: null, totalCount: { gt: 0 } },
    select: { owner: true, repo: true, totalCount: true, forksCount: true, watchersCount: true },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
  });

  if (rows.length === 0) {
    console.log("No rows to backfill — all badge_cache rows already have organicTier.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Backfilling ${rows.length} repos${DRY_RUN ? " (dry-run)" : ""}...`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const { owner, repo } = row;

    let forks = row.forksCount;
    let watchers = row.watchersCount;
    let releasesCount: number | null = null;

    if (forks === null || watchers === null) {
      const gh = await fetchGitHubData(owner, repo);
      if (!gh) {
        console.warn(`  [SKIP] ${owner}/${repo} — GitHub fetch failed`);
        skipped++;
        continue;
      }
      forks = gh.forksCount;
      watchers = gh.watchersCount;
      releasesCount = gh.releasesCount;
    } else {
      releasesCount = await fetchReleasesCount(owner, repo);
      await sleep(DELAY_MS);
    }

    const [sample] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
        COUNT(*)::bigint                                  AS sample_size
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner}
        AND se.repo  = ${repo}
        AND gu."dataVersion" >= 1
    `;

    const result = computeOrganicScore({
      starsCount:        row.totalCount,
      forksCount:        forks,
      watchersCount:     watchers,
      zeroFollowerCount: sample ? Number(sample.zero_count) : null,
      sampleSize:        sample ? Number(sample.sample_size) : null,
      releasesCount,
    });

    const label = result.tier === "insufficient"
      ? `tier=insufficient score=null`
      : `score=${result.score} tier=${result.tier}`;

    if (DRY_RUN) {
      console.log(`  [DRY] ${owner}/${repo} → ${label}`);
      updated++;
      continue;
    }

    try {
      await prisma.badgeCache.update({
        where: { owner_repo: { owner, repo } },
        data: {
          organicScore:      result.score,
          organicTier:       result.tier,
          organicComputedAt: new Date(),
          forksCount:        forks,
          watchersCount:     watchers,
          ...(releasesCount !== null && { releasesCount }),
        },
      });
      console.log(`  [OK]  ${owner}/${repo} → ${label}`);
      updated++;
    } catch (err) {
      console.error(`  [ERR] ${owner}/${repo}`, err);
      failed++;
    }
  }

  console.log(`\nDone — updated: ${updated}, skipped: ${skipped}, failed: ${failed}`);
  await prisma.$disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
