// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Indexes all repos from meetup attendees directly against Neon — zero HTTP to StarMapper.
// Replaces batch-index-meetup.sh + save-repo-cache.ts.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/batch-index-meetup.ts [--dry-run] [--limit=N]

import { parseArgs } from "node:util";
import { prisma } from "@/lib/db";
import { fetchStargazersPage, GitHubRateLimitError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { compressToGzBase64 } from "@/lib/compression";
import { computeOrganicScore } from "@/lib/organic-score";
import { parseLocation } from "@/lib/location-parser";
import { bulkUpsertUsers, bulkUpsertStarEvents, type UserWritePayload } from "@/lib/user-cache";
import { checkDbHealth } from "@/lib/db-health";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit:     { type: "string" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const DRY_RUN  = values["dry-run"];
const LIMIT    = values.limit ? parseInt(values.limit, 10) : Infinity;
const GH_TOKEN = process.env.GITHUB_TOKEN;

const PROFILES: string[] = [
  "SaboniAmine", "j-abi", "DGouron", "StephenGodard", "remster85", "Justinodjo",
  "andreas-roehler", "atrahay", "axelguilmin", "b-2-83", "Brahimk", "C-Vellen",
  "Cyphle", "Ebed-meleck", "bashlor", "whispem", "erdprt", "ExploryKod",
  "izumiberat", "longplayer", "LuaGeo", "Mco-Design", "MaximilienMoreau", "bracketouverte",
  "goumix", "Nouhayousse", "patjoub-sc", "sharbatc", "SimonCollet90", "tracy040401",
  "skyjiao", "yg0a1n", "dot-yaya",
];

const DIRECT_REPOS: string[] = [
  "cmnemoi/emush-rag",
  "cmnemoi/sightcall-qa-api",
  "DragosDreptate/the-playground",
  "dilolabs/nosia",
  "SamuelPrigent/Poplist",
  "IvandeMurard/aetherix-hospitality-ai",
];

// ---- GitHub REST helpers -----------------------------------------------

type GhRepo = { full_name: string; stargazers_count: number; forks_count: number; subscribers_count: number; language: string | null };

const ghHeaders = (): Record<string, string> => ({
  Accept: "application/vnd.github.v3+json",
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
});

const ghGet = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub REST ${res.status} on ${url}`);
  return res.json();
};

const fetchReleasesCount = async (owner: string, repo: string): Promise<number | null> => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`,
      { headers: ghHeaders() },
    );
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

const fetchContributorsCount = async (owner: string, repo: string): Promise<number | null> => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=1`,
      { headers: ghHeaders() },
    );
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

const resolveProfile = async (username: string): Promise<Array<{ full_name: string; stars: number }>> => {
  const repos: Array<{ full_name: string; stars: number }> = [];
  let page = 1;
  while (true) {
    const batch = await ghGet(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=stars&page=${page}`,
    ) as GhRepo[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (r.stargazers_count > 0) repos.push({ full_name: r.full_name, stars: r.stargazers_count });
    }
    if (batch.length < 100) break;
    page++;
  }
  return repos;
};

// ---- Per-repo indexing -------------------------------------------------

type RepoEntry = { owner: string; repo: string; stars: number };

const indexRepo = async (entry: RepoEntry): Promise<void> => {
  const { owner, repo, stars } = entry;
  const key = { owner, repo };

  console.log(`\n  → ${owner}/${repo} (${stars} stars)`);

  if (DRY_RUN) {
    console.log("    [dry-run] skip");
    return;
  }

  const points: Array<{
    login: string; name: string | null; bio: string | null; company: string | null;
    location: string | null; followers: number; avatarUrl: string;
    lat: number; lng: number; starredAt: string | null; linkedinUrl: string | null;
  }> = [];
  const unmapped: Array<{ login: string; name: string | null; followers: number; starredAt: string | null }> = [];

  const dbHealth = await checkDbHealth();
  const userWritePayloads: UserWritePayload[] = [];
  const starEvents: Array<{ login: string; owner: string; repo: string; starredAt: string }> = [];

  let cursor: string | null = null;
  let chunkNum = 0;
  let latestStarredAt: string | null = null;

  // Chunk loop — fetchStargazersPage + geocodeBatch, direct imports, no HTTP to StarMapper
  while (true) {
    chunkNum++;
    let page;
    try {
      page = await fetchStargazersPage(owner, repo, cursor);
    } catch (err) {
      if (err instanceof GitHubRateLimitError) {
        const waitMs = Math.max(err.resetAt - Date.now(), 0) + 5000;
        console.log(`    ⏳ GitHub rate limit — wait ${Math.round(waitMs / 1000)}s`);
        await new Promise(r => setTimeout(r, waitMs));
        page = await fetchStargazersPage(owner, repo, cursor);
      } else {
        throw err;
      }
    }

    // Extract non-empty locations for batch geocoding
    const locations = page.stargazers
      .map(sg => sg.location)
      .filter((l): l is string => !!l?.trim());

    const geoMap = locations.length > 0 ? await geocodeBatch(locations) : new Map<string, [number, number] | null>();

    let chunkMapped = 0;
    for (const sg of page.stargazers) {
      // geocodeBatch keys its result Map by the RAW location string (matching
      // the production /api/chunk consumer). Looking up with a normalized key
      // misses everything except already-lowercase locations.
      const loc = sg.location ?? "";
      const coords = loc ? geoMap.get(loc) ?? null : null;

      if (coords) {
        chunkMapped++;
        const [lat, lng] = coords;
        points.push({
          login: sg.login, name: sg.name, bio: sg.bio, company: sg.company,
          location: sg.location, followers: sg.followers, avatarUrl: sg.avatarUrl,
          lat, lng, starredAt: sg.starredAt, linkedinUrl: sg.linkedinUrl,
        });

        const { country, city } = parseLocation(sg.location);
        userWritePayloads.push({
          login: sg.login, name: sg.name, company: sg.company, location: sg.location,
          followers: sg.followers, following: sg.following, publicRepos: sg.publicRepos,
          accountCreatedAt: sg.accountCreatedAt, lat, lng, linkedinUrl: sg.linkedinUrl,
          countryNormalized: country, cityNormalized: city,
        });
        // star_event has FK on github_user.login — only insert for mapped users
        if (sg.starredAt) {
          starEvents.push({ login: sg.login, owner, repo, starredAt: sg.starredAt });
        }
      } else {
        unmapped.push({ login: sg.login, name: sg.name, followers: sg.followers, starredAt: sg.starredAt });
      }

      if (sg.starredAt && (!latestStarredAt || sg.starredAt > latestStarredAt)) {
        latestStarredAt = sg.starredAt;
      }
    }

    console.log(
      `    chunk ${chunkNum} | +${chunkMapped} mapped | total ${points.length}/${points.length + unmapped.length}`,
    );

    cursor = page.nextCursor;
    if (!cursor) break;
  }

  console.log(`    ✓ ${points.length} mapped, ${unmapped.length} unmapped`);

  // Write user-cache + star events (enriches organic score signals)
  if (userWritePayloads.length > 0) {
    await bulkUpsertUsers(userWritePayloads, dbHealth);
    await bulkUpsertStarEvents(starEvents, dbHealth);
  }

  // Stargazer cache — compressed, direct Prisma write
  const pointsGz   = compressToGzBase64(points);
  const unmappedGz  = compressToGzBase64(unmapped);
  await prisma.stargazerCache.upsert({
    where:  { owner_repo: key },
    create: { ...key, points: pointsGz, unmapped: unmappedGz, totalCount: points.length + unmapped.length, indexedBy: "batch-script", scannedAt: new Date(), latestStarredAt: latestStarredAt ? new Date(latestStarredAt) : null },
    update: { points: pointsGz, unmapped: unmappedGz, totalCount: points.length + unmapped.length, indexedBy: "batch-script", scannedAt: new Date(), latestStarredAt: latestStarredAt ? new Date(latestStarredAt) : null },
  });
  console.log("    ✓ stargazer-cache");

  // Fetch GitHub metadata + organic score signals in parallel
  const [meta, releasesCount, contributorsCount, zfRow] = await Promise.all([
    ghGet(`https://api.github.com/repos/${owner}/${repo}`).catch(() => null) as Promise<GhRepo | null>,
    fetchReleasesCount(owner, repo),
    fetchContributorsCount(owner, repo),
    prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
             COUNT(*)::bigint AS sample_size
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner} AND se.repo = ${repo} AND gu."dataVersion" >= 1
    `.then(rows => rows[0] ?? null).catch(() => null),
  ]);

  const forksCount    = meta?.forks_count ?? 0;
  const watchersCount = meta?.subscribers_count ?? 0;
  const language      = meta?.language ?? null;
  const totalCount    = meta?.stargazers_count ?? (points.length + unmapped.length);
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

  await prisma.badgeCache.upsert({
    where:  { owner_repo: key },
    create: {
      ...key, mappedCount: points.length, countryCount: 0, totalCount,
      language, forksCount, watchersCount,
      organicScore: scoreResult.score, organicTier: scoreResult.tier,
      organicComputedAt: new Date(), releasesCount, contributorsCount,
    },
    update: {
      mappedCount: points.length, totalCount, language, forksCount, watchersCount,
      organicScore: scoreResult.score, organicTier: scoreResult.tier,
      organicComputedAt: new Date(), releasesCount, contributorsCount,
    },
  });

  const scoreStr = scoreResult.score !== null ? `${scoreResult.score}` : "n/a";
  console.log(`    ✓ badge + score: ${scoreStr} (${scoreResult.tier}) | https://starmapper.bruniaux.com/${owner}/${repo}`);
};

// ---- Main --------------------------------------------------------------

const main = async () => {
  console.log("==============================");
  console.log(` StarMapper — Batch Indexer (TypeScript)`);
  console.log(` Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  console.log("==============================");

  if (!GH_TOKEN) console.warn("⚠ GITHUB_TOKEN absent — rate limit: 60 req/hr");

  // Phase 1: resolve profiles → deduplicated repo list
  console.log("\n--- Phase 1: résolution des profils ---");
  const repoMap = new Map<string, number>();

  for (const username of PROFILES) {
    try {
      const repos = await resolveProfile(username);
      for (const { full_name, stars } of repos) {
        const existing = repoMap.get(full_name) ?? 0;
        if (stars > existing) repoMap.set(full_name, stars);
      }
      process.stdout.write(`  ${username}: ${repos.length} repos\n`);
    } catch (err) {
      console.error(`  ⚠ ${username}: ${(err as Error).message}`);
    }
  }

  for (const fullName of DIRECT_REPOS) {
    if (!repoMap.has(fullName)) {
      try {
        const meta = await ghGet(`https://api.github.com/repos/${fullName}`) as GhRepo;
        if (meta.stargazers_count > 0) repoMap.set(fullName, meta.stargazers_count);
      } catch (err) {
        console.error(`  ⚠ ${fullName}: ${(err as Error).message}`);
      }
    }
  }

  // Sort by stars descending, deduplicated
  const repos: RepoEntry[] = [...repoMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([full_name, stars]) => {
      const slash = full_name.indexOf("/");
      return { owner: full_name.slice(0, slash).toLowerCase(), repo: full_name.slice(slash + 1).toLowerCase(), stars };
    })
    .slice(0, LIMIT);

  const totalStars = repos.reduce((s, r) => s + r.stars, 0);
  console.log(`\nTotal repos: ${repos.length} | Total stars: ${totalStars}`);

  // Phase 2: index each repo
  console.log("\n--- Phase 2: indexation ---");
  let indexed = 0;
  let failed = 0;
  for (const entry of repos) {
    // A transient network error on one repo must not abort the whole batch.
    try {
      await indexRepo(entry);
      indexed++;
    } catch (err) {
      failed++;
      console.error(`  ⚠ ${entry.owner}/${entry.repo} failed: ${(err as Error).message}`);
    }
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 1000)); // polite delay between repos
  }
  if (failed > 0) console.log(`\n⚠ ${failed} repo(s) échoué(s) — relancer le script les reprendra (idempotent).`);

  console.log(`\n==============================`);
  console.log(` ${DRY_RUN ? "Dry-run terminé" : "Terminé"}. ${indexed} repos indexés.`);
  console.log("==============================");
};

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
