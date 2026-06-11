// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Saves chunk loop results directly to Neon — no HTTP, no rate limits.
// Writes stargazerCache (gzip), badgeCache, and computes organic score.
//
// Usage (requires .env.local with DATABASE_URL pointing to Neon):
//   pnpm tsx --env-file=.env.local scripts/save-repo-cache.ts \
//     --owner X --repo Y \
//     --points-file /tmp/pts.json --unmapped-file /tmp/unm.json \
//     --total N --forks N --watchers N [--language ts] [--dry-run]

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { compressToGzBase64 } from "@/lib/compression";
import { computeOrganicScore } from "@/lib/organic-score";

const { values } = parseArgs({
  options: {
    owner:          { type: "string" },
    repo:           { type: "string" },
    "points-file":  { type: "string" },
    "unmapped-file":{ type: "string" },
    total:          { type: "string", default: "0" },
    forks:          { type: "string", default: "0" },
    watchers:       { type: "string", default: "0" },
    language:       { type: "string" },
    "dry-run":      { type: "boolean", default: false },
  },
  strict: true,
  args: process.argv.slice(2),
});

const ghFetch = async (url: string, token: string | undefined): Promise<Response> => {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers });
};

const fetchReleasesCount = async (owner: string, repo: string, token: string | undefined): Promise<number | null> => {
  try {
    const res = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`, token);
    if (!res.ok) return null;
    const link = res.headers.get("link");
    if (link) {
      const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      return m ? parseInt(m[1], 10) : 1;
    }
    const items = await res.json() as unknown[];
    return items.length;
  } catch { return null; }
};

const fetchContributorsCount = async (owner: string, repo: string, token: string | undefined): Promise<number | null> => {
  try {
    const res = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=1`, token);
    if (!res.ok) return null;
    const link = res.headers.get("link");
    if (link) {
      const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (m) return parseInt(m[1], 10);
    }
    const items = await res.json() as unknown[];
    return items.length;
  } catch { return null; }
};

const main = async () => {
  if (!values.owner || !values.repo || !values["points-file"] || !values["unmapped-file"]) {
    console.error("Usage: save-repo-cache.ts --owner X --repo Y --points-file F --unmapped-file F --total N");
    process.exit(1);
  }

  const owner      = values.owner.toLowerCase();
  const repo       = values.repo.toLowerCase();
  const totalCount = parseInt(values.total ?? "0", 10);
  const forksCount = parseInt(values.forks ?? "0", 10);
  const watchersCount = parseInt(values.watchers ?? "0", 10);
  const language   = values.language ?? null;
  const dryRun     = values["dry-run"];
  const key        = { owner, repo };
  const token      = process.env.GITHUB_TOKEN;

  const [pointsRaw, unmappedRaw] = await Promise.all([
    readFile(values["points-file"], "utf-8").then(s => JSON.parse(s) as unknown[]),
    readFile(values["unmapped-file"], "utf-8").then(s => JSON.parse(s) as unknown[]),
  ]);
  const mappedCount = pointsRaw.length;

  console.log(`  ${owner}/${repo}: ${mappedCount} mapped, ${unmappedRaw.length} unmapped, total ${totalCount}`);

  if (dryRun) {
    console.log("  [dry-run] skip");
    return;
  }

  // 1. Stargazer cache — compressed directly here, no HTTP freshness check needed
  const pointsGz   = compressToGzBase64(pointsRaw);
  const unmappedGz = compressToGzBase64(unmappedRaw);
  await prisma.stargazerCache.upsert({
    where:  { owner_repo: key },
    create: { ...key, points: pointsGz, unmapped: unmappedGz, totalCount, indexedBy: "batch-script", scannedAt: new Date() },
    update: { points: pointsGz, unmapped: unmappedGz, totalCount, indexedBy: "batch-script", scannedAt: new Date() },
  });
  console.log("  ✓ stargazer-cache");

  // 2. Fetch organic score signals in parallel — DB query + 2 GitHub calls
  const [zfRow, releasesCount, contributorsCount] = await Promise.all([
    prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
        COUNT(*)::bigint AS sample_size
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner} AND se.repo = ${repo}
        AND gu."dataVersion" >= 1
    `.then(rows => rows[0] ?? null).catch(() => null),
    fetchReleasesCount(owner, repo, token),
    fetchContributorsCount(owner, repo, token),
  ]);

  const zeroFollowerCount = zfRow ? Number(zfRow.zero_count) : null;
  const sampleSize        = zfRow ? Number(zfRow.sample_size) : null;

  const scoreResult = computeOrganicScore({
    starsCount:        totalCount,
    forksCount,
    watchersCount,
    zeroFollowerCount: sampleSize && sampleSize > 0 ? zeroFollowerCount : null,
    sampleSize:        sampleSize ?? null,
    releasesCount,
    contributorsCount,
  });

  // 3. Badge cache + organic score
  await prisma.badgeCache.upsert({
    where:  { owner_repo: key },
    create: {
      ...key,
      mappedCount,
      countryCount: 0,
      totalCount,
      language,
      forksCount,
      watchersCount,
      organicScore:      scoreResult.score,
      organicTier:       scoreResult.tier,
      organicComputedAt: new Date(),
      releasesCount,
      contributorsCount,
    },
    update: {
      mappedCount,
      totalCount,
      language,
      forksCount,
      watchersCount,
      organicScore:      scoreResult.score,
      organicTier:       scoreResult.tier,
      organicComputedAt: new Date(),
      releasesCount,
      contributorsCount,
    },
  });

  const scoreStr = scoreResult.score !== null ? `${scoreResult.score}` : "n/a";
  console.log(`  ✓ badge + score: ${scoreStr} (${scoreResult.tier})`);
};

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
