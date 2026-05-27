// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Backfill forksCount + watchersCount + organicScore for badge_cache rows that are missing them.
// Usage:
//   pnpm backfill:repo-metrics           — backfill all rows where forksCount IS NULL
//   pnpm backfill:repo-metrics --dry-run — preview what would be updated, no writes
//   pnpm backfill:repo-metrics --force   — recompute all rows, even if forksCount is already set

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { computeOrganicScore } from "../../src/lib/organic-score";

const GH_TOKEN = process.env.GITHUB_TOKEN;
const ORGANIC_ENABLED = process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED === "true";
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const CONCURRENCY = 5;
const RETRY_LIMIT = 1;
const GATE_MIN_STARS = 5000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type GhRepo = {
  forks_count: number;
  subscribers_count: number;
  stargazers_count: number;
  open_issues_count: number;
};

type GhRelease = { tag_name: string; html_url: string; published_at: string };

const fetchRepoMeta = async (owner: string, repo: string, attempt = 0): Promise<GhRepo | null> => {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
  };
  try {
    const res = await fetch(url, { headers });
    if (res.status === 404 || res.status === 410) return null; // deleted / moved
    if (res.status === 403 || res.status === 429) {
      if (attempt < RETRY_LIMIT) {
        await new Promise((r) => setTimeout(r, 5000));
        return fetchRepoMeta(owner, repo, attempt + 1);
      }
      console.warn(`[skip] ${owner}/${repo} — rate limited`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[skip] ${owner}/${repo} — HTTP ${res.status}`);
      return null;
    }
    return await res.json() as GhRepo;
  } catch (e) {
    if (attempt < RETRY_LIMIT) {
      await new Promise((r) => setTimeout(r, 2000));
      return fetchRepoMeta(owner, repo, attempt + 1);
    }
    console.warn(`[skip] ${owner}/${repo} — network error`);
    return null;
  }
};

const fetchZeroFollowerSample = async (owner: string, repo: string): Promise<{ zeroCount: number; sampleSize: number } | null> => {
  try {
    const [row] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
        COUNT(*)::bigint AS sample_size
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner} AND se.repo = ${repo}
        AND gu."dataVersion" >= 1
    `;
    if (!row || Number(row.sample_size) === 0) return null;
    return { zeroCount: Number(row.zero_count), sampleSize: Number(row.sample_size) };
  } catch {
    // Neon statement timeout on large tables — zero-follower signal skipped for this repo
    return null;
  }
};

type WorkItem = { owner: string; repo: string; totalCount: number };

const fetchLatestRelease = async (owner: string, repo: string): Promise<GhRelease | null> => {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
  };
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
    if (!res.ok) return null;
    return await res.json() as GhRelease;
  } catch { return null; }
};

const processOne = async (item: WorkItem): Promise<"updated" | "skipped" | "no-data"> => {
  const { owner, repo } = item;
  const [meta, release] = await Promise.all([
    fetchRepoMeta(owner, repo),
    fetchLatestRelease(owner, repo),
  ]);
  if (!meta) return "no-data";

  let organicScore: number | null = null;
  let organicTier: string | null = null;
  let organicComputedAt: Date | null = null;

  if (ORGANIC_ENABLED && meta.stargazers_count >= GATE_MIN_STARS) {
    const zf = await fetchZeroFollowerSample(owner, repo);
    const result = computeOrganicScore({
      starsCount:        meta.stargazers_count,
      forksCount:        meta.forks_count,
      watchersCount:     meta.subscribers_count,
      zeroFollowerCount: zf?.zeroCount ?? null,
      sampleSize:        zf?.sampleSize ?? null,
      releasesCount:     null, // backfill script — releases count not fetched here
    });
    organicScore      = result.score;
    organicTier       = result.tier;
    organicComputedAt = new Date();
  }

  if (!DRY_RUN) {
    await prisma.badgeCache.update({
      where: { owner_repo: { owner, repo } },
      data: {
        forksCount:       meta.forks_count,
        watchersCount:    meta.subscribers_count,
        totalCount:       meta.stargazers_count,
        openIssuesCount:  meta.open_issues_count,
        latestReleaseTag: release?.tag_name ?? null,
        latestReleaseUrl: release?.html_url ?? null,
        latestReleaseAt:  release?.published_at ? new Date(release.published_at) : null,
        ...(organicComputedAt && { organicScore, organicTier, organicComputedAt }),
      },
    });
  }

  const score = organicScore !== null ? ` (score=${organicScore} tier=${organicTier})` : "";
  console.log(`[${DRY_RUN ? "dry" : "ok"}] ${owner}/${repo} — forks=${meta.forks_count} watchers=${meta.subscribers_count}${score}`);
  return "updated";
};

const runBatch = async (items: WorkItem[]): Promise<void> => {
  let i = 0;
  const results = { updated: 0, skipped: 0, noData: 0 };

  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      const outcome = await processOne(item);
      results[outcome === "updated" ? "updated" : outcome === "skipped" ? "skipped" : "noData"]++;
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone — updated=${results.updated} skipped=${results.skipped} no-data=${results.noData}`);
};

const main = async () => {
  console.log(`Backfill repo metrics${DRY_RUN ? " (DRY RUN)" : ""}${FORCE ? " (FORCE)" : ""}`);

  const rows = await prisma.badgeCache.findMany({
    where: FORCE ? {} : { forksCount: null },
    select: { owner: true, repo: true, totalCount: true },
    orderBy: { totalCount: "desc" },
  });

  console.log(`Found ${rows.length} badge_cache rows to process`);
  if (rows.length === 0) { console.log("Nothing to do."); return; }

  await runBatch(rows);
};

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
