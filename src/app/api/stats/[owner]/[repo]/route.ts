// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import type { OrganicTier } from "@/lib/organic-score";

export const maxDuration = 30;

export type RepoOrganic = {
  score: number | null;
  tier: OrganicTier;
  computedAt: string | null;
  forksCount: number | null;
  watchersCount: number | null;
  totalCount: number;
  openIssuesCount: number | null;
  openPRsCount: number | null;
  latestReleaseTag: string | null;
  latestReleaseUrl: string | null;
  latestReleaseAt: string | null;
  releasesCount: number | null;
  contributorsCount: number | null;
};

export type RepoStats = {
  totalStars: number;
  mappedCount: number;
  mappingRate: number;
  avgFollowers: number;
  countryCount: number;
  topCountries: [string, number][];
  topCities: [string, number][];
  topCompanies: [string, number][];
  topUsers: { login: string; name: string | null; followers: number; publicRepos: number; location: string | null; avatarUrl: string; company: string | null }[];
  powerStargazers: { login: string; name: string | null; followers: number; trackedRepos: number; avatarUrl: string }[];
  botCount: number;
  enrichedUserCount: number;
  isCapped: boolean;
  organic: RepoOrganic | null;
  isPartial?: boolean;
  /**
   * Where the aggregates came from. Absent when the stats are computed client-side
   * (page.client.tsx) or when REPO_STATS_MV_ENABLED is off, so that turning the flag off
   * restores byte-identical responses.
   */
  source?: "precomputed" | "live";
  /**
   * Timestamp of the repo_stats_mv REFRESH that produced these numbers, ISO 8601.
   * Only present when source === "precomputed".
   * Not to be confused with organic.computedAt (RepoOrganic), which dates the organic
   * score and comes from badge_cache.
   */
  computedAt?: string;
};

type RepoStatsMvRow = {
  total: bigint;
  mapped: bigint;
  avg_followers: number;
  enriched: bigint;
  bots: bigint;
  // NOW() is a timestamptz (OID 1184), unlike badge_cache."updatedAt" which is a
  // timestamp(3) (OID 1114). The Neon adapter is only known to hand back a Date for the
  // latter, so this is typed for both and normalised through new Date() at the call site.
  // Getting it wrong would throw a TypeError on every precomputed repo, and no unit test
  // can catch it because the mock supplies a real Date.
  computed_at: Date | string;
};

const isNeonTimeout = (err: unknown): boolean => {
  if (err instanceof Error) {
    return err.message.includes("57014") || err.message.includes("canceling statement due to statement timeout");
  }
  return false;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    // 1. badge_cache first — fast lookup, used as fallback when aggregation timeouts
    const badgeRow = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: {
        organicScore: true, organicTier: true, organicComputedAt: true,
        forksCount: true, watchersCount: true, totalCount: true,
        mappedCount: true, countryCount: true,
        openIssuesCount: true,
        openPRsCount: true,
        latestReleaseTag: true, latestReleaseUrl: true, latestReleaseAt: true,
        releasesCount: true,
        contributorsCount: true,
      },
    });

    // 2. Aggregate totals via JOIN — slow on large repos; catch Neon timeout
    let total = 0, mappedCount = 0, avgFollowers = 0, enrichedUserCount = 0, botCount = 0;
    let joinTimedOut = false;
    let source: RepoStats["source"];
    let computedAt: string | undefined;

    // Read inside the handler, never as a module constant: a module constant freezes at cold
    // start, so flipping the flag on Vercel would take an unpredictable amount of time to
    // roll back, and vi.stubEnv would have no effect in tests.
    const mvEnabled = process.env.REPO_STATS_MV_ENABLED === "true";

    // Flag off means not a single extra query is issued, which keeps the $queryRaw call
    // sequence identical to the pre-MV route. The existing tests mock $queryRaw by position
    // (__tests__/route.test.ts:79-83), so an extra query here would shift all four mocks.
    let mvRow: RepoStatsMvRow | null = null;
    if (mvEnabled) {
      try {
        const [row] = await prisma.$queryRaw<RepoStatsMvRow[]>`
          SELECT total, mapped, avg_followers, enriched, bots, computed_at
          FROM repo_stats_mv
          WHERE owner = ${key.owner} AND repo = ${key.repo}
        `;
        mvRow = row ?? null;
      } catch (err) {
        // The view may not exist yet (flag flipped before the migration ran) or the read may
        // fail. Falling through to the live path is the whole point: enabling the flag early
        // degrades to today's behaviour instead of returning 500 on every repo.
        logError(`stats/repo_stats_mv [${key.owner}/${key.repo}]`, err);
      }
    }

    if (mvRow) {
      source = "precomputed";
      computedAt = new Date(mvRow.computed_at).toISOString();
      total = Number(mvRow.total);
      mappedCount = Number(mvRow.mapped);
      avgFollowers = Math.round(mvRow.avg_followers ?? 0);
      enrichedUserCount = Number(mvRow.enriched);
      botCount = Number(mvRow.bots);
    } else if (mvEnabled) {
      source = "live";
    }

    if (!mvRow) {
      try {
        const [totals] = await prisma.$queryRaw<{
          total: bigint;
          mapped: bigint;
          avg_followers: number;
          enriched: bigint;
          bots: bigint;
        }[]>`
          SELECT
            COUNT(*)                                                                                             AS total,
            COUNT(*) FILTER (WHERE u.lat IS NOT NULL AND u.lng IS NOT NULL)                                     AS mapped,
            COALESCE(AVG(u.followers)::int, 0)                                                                  AS avg_followers,
            COUNT(*) FILTER (WHERE u."dataVersion" >= 1)                                                        AS enriched,
            COUNT(*) FILTER (WHERE u."dataVersion" >= 1 AND u.followers < 5 AND u.following < 5 AND u."publicRepos" < 2) AS bots
          FROM star_event se
          JOIN github_user u USING (login)
          WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
        `;

        if (!totals || Number(totals.total) === 0) {
          // No star_event rows — fall through to badge_cache or 404
          if (!badgeRow) return jsonError("no_data", 404);
          joinTimedOut = true;
        } else {
          total = Number(totals.total);
          mappedCount = Number(totals.mapped);
          enrichedUserCount = Number(totals.enriched);
          botCount = Number(totals.bots);
          avgFollowers = Math.round(totals.avg_followers ?? 0);
        }
      } catch (err) {
        if (isNeonTimeout(err)) {
          joinTimedOut = true;
          // Repo identity goes in the tag, not as a second arg: logError() calls
          // sanitizeError(err), which stringifies a plain object to "[object Object]".
          // Same convention as admin/refresh-trending/route.ts.
          logError(`stats/totals timeout [${key.owner}/${key.repo}]`, err);
        } else {
          throw err;
        }
      }
    }

    // Fallback: use badge_cache totals when JOIN timed out. Unreachable on the precomputed
    // path: joinTimedOut can only be set by the live block above.
    if (joinTimedOut) {
      if (!badgeRow) return jsonError("no_data", 404);
      total = badgeRow.totalCount;
      mappedCount = badgeRow.mappedCount ?? 0;
    }

    // 3. Location + company + power queries — independent JOINs; one timing out
    // must not blank out the other two, which may already have resolved
    // successfully. Each catches its own Neon timeout instead of sharing a
    // single Promise.all that rejects on the first failure.
    const queryOrEmpty = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        if (isNeonTimeout(err)) {
          logError(`stats/${label} timeout [${key.owner}/${key.repo}]`, err);
          return [];
        }
        throw err;
      }
    };

    let locationRows: { location: string; cnt: bigint }[] = [];
    let companyRows: { company: string; cnt: bigint }[] = [];
    let crossRepoGroups: { login: string; cnt: bigint }[] = [];

    // Unlike queryOrEmpty, this swallows every error rather than only Neon timeouts.
    // A missing view raises 42P01, and create-repo-stats-mvs.sql commits one CREATE at a
    // time, so an interrupted build can genuinely leave repo_stats_mv in place with the
    // dimension views absent. Letting 42P01 propagate would 500 every repo found in
    // repo_stats_mv, which is strictly worse than the fallback the scalar read above
    // already guarantees. Same posture as devs-query.ts, "MV not yet created".
    let mvDegraded = false;
    const mvQueryOrEmpty = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        mvDegraded = true;
        logError(`stats/${label} [${key.owner}/${key.repo}]`, err);
        return [];
      }
    };

    if (mvRow) {
      // The three dimension views already carry the same bounds as the live queries below
      // (top 200 locations, 50 companies, 20 power users), applied at REFRESH time by a
      // ROW_NUMBER() window. No LIMIT here on purpose: adding one would silently diverge if
      // the view bounds ever change. Each read is an index scan on (owner, repo, cnt DESC).
      [locationRows, companyRows, crossRepoGroups] = await Promise.all([
        mvQueryOrEmpty("location-mv", () => prisma.$queryRaw<{ location: string; cnt: bigint }[]>`
          SELECT location, cnt
          FROM repo_location_stats_mv
          WHERE owner = ${key.owner} AND repo = ${key.repo}
          ORDER BY cnt DESC
        `),
        mvQueryOrEmpty("company-mv", () => prisma.$queryRaw<{ company: string; cnt: bigint }[]>`
          SELECT company, cnt
          FROM repo_company_stats_mv
          WHERE owner = ${key.owner} AND repo = ${key.repo}
          ORDER BY cnt DESC
        `),
        mvQueryOrEmpty("power-users-mv", () => prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
          SELECT login, cnt
          FROM repo_power_users_mv
          WHERE owner = ${key.owner} AND repo = ${key.repo}
          ORDER BY cnt DESC
        `),
      ]);
    } else if (!joinTimedOut) {
      [locationRows, companyRows, crossRepoGroups] = await Promise.all([
        queryOrEmpty("location", () => prisma.$queryRaw<{ location: string; cnt: bigint }[]>`
          SELECT u.location, COUNT(*) AS cnt
          FROM star_event se
          JOIN github_user u USING (login)
          WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
            AND u.location IS NOT NULL
          GROUP BY u.location
          ORDER BY cnt DESC
          LIMIT 200
        `),
        queryOrEmpty("company", () => prisma.$queryRaw<{ company: string; cnt: bigint }[]>`
          SELECT u.company, COUNT(*) AS cnt
          FROM star_event se
          JOIN github_user u USING (login)
          WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
            AND u.company IS NOT NULL
          GROUP BY u.company
          ORDER BY cnt DESC
          LIMIT 50
        `),
        // MATERIALIZED forces Postgres to compute repo_logins (a handful of rows
        // for a niche repo, up to a few hundred thousand for a top repo) before
        // joining power_users_mv, instead of the planner's own plan, which starts
        // from power_users_mv (3.6M rows) in cnt-desc order and probes star_event
        // per row (that scan runs past its statement_timeout regardless of repo
        // size). Measured directly against Neon prod (2026-07-23, cold cache,
        // EXPLAIN ANALYZE): the old plan times out (>25s) on every repo tested,
        // 531 to 361 334 stars. This rewrite: 2.3-2.6s cold cache (dominated by
        // the unavoidable 62 055-page scan of power_users_mv), under 10ms warm,
        // flat across that same size range. No repo-size branch is needed: the
        // cost is bounded by power_users_mv's size, not the target repo's.
        queryOrEmpty("power-users", () => prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
          WITH repo_logins AS MATERIALIZED (
            SELECT login FROM star_event WHERE owner = ${key.owner} AND repo = ${key.repo}
          )
          SELECT mv.login, mv.cnt
          FROM power_users_mv mv
          JOIN repo_logins rl ON rl.login = mv.login
          ORDER BY mv.cnt DESC
          LIMIT 20
        `),
      ]);
    }

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    for (const { location, cnt } of locationRows) {
      const n = Number(cnt);
      const { country, city } = parseLocation(location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + n);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + n);
    }

    const companyCount = new Map(companyRows.map(({ company, cnt }) => [company, Number(cnt)] as [string, number]));

    // Fetch user details for power stargazers (small list — max 20)
    const powerLogins = crossRepoGroups.map((g) => g.login);
    const powerUsers = powerLogins.length > 0
      ? await prisma.gitHubUser.findMany({
          where: { login: { in: powerLogins } },
          select: { login: true, name: true, followers: true },
        })
      : [];
    const powerUserMap = new Map(powerUsers.map((u) => [u.login, u]));
    const powerStargazers = crossRepoGroups.map((g) => {
      const u = powerUserMap.get(g.login);
      return {
        login: g.login,
        name: u?.name ?? null,
        followers: u?.followers ?? 0,
        trackedRepos: Number(g.cnt),
        avatarUrl: `https://github.com/${g.login}.png`,
      };
    });

    const organic: RepoOrganic | null = badgeRow?.organicTier
      ? {
          score:            badgeRow.organicScore,
          tier:             badgeRow.organicTier as OrganicTier,
          computedAt:       badgeRow.organicComputedAt?.toISOString() ?? null,
          forksCount:       badgeRow.forksCount,
          watchersCount:    badgeRow.watchersCount,
          totalCount:       badgeRow.totalCount,
          openIssuesCount:  badgeRow.openIssuesCount ?? null,
          openPRsCount:     badgeRow.openPRsCount ?? null,
          latestReleaseTag: badgeRow.latestReleaseTag ?? null,
          latestReleaseUrl: badgeRow.latestReleaseUrl ?? null,
          latestReleaseAt:  badgeRow.latestReleaseAt?.toISOString() ?? null,
          releasesCount:     badgeRow.releasesCount ?? null,
          contributorsCount: badgeRow.contributorsCount ?? null,
        }
      : null;

    // Use badge_cache countryCount when available and our computed one is empty (timeout)
    const finalCountryCount = countryCount.size > 0
      ? countryCount.size
      : (badgeRow?.countryCount ?? 0);

    // A precomputed response can be incomplete in two ways, and they look identical to the
    // user: a dimension read failed (mvDegraded), or part=2 of the refresh cron has not run
    // yet, which leaves repo_stats_mv populated while the dimension views hold nothing for
    // this repo. Either way the panel shows no country, no city and no company, so it must
    // not sit in the CDN for 15 minutes. Only reachable on the precomputed path, so with the
    // flag off this reduces to joinTimedOut and the response stays byte-identical.
    const mvIncomplete =
      mvRow !== null && (mvDegraded || (total > 0 && locationRows.length === 0));
    const partial = joinTimedOut || mvIncomplete;

    const stats: RepoStats = {
      totalStars: total,
      mappedCount,
      mappingRate: total > 0 ? Math.round((mappedCount / total) * 100) : 0,
      avgFollowers,
      countryCount: finalCountryCount,
      topCountries: [...countryCount.entries()].sort((a, b) => b[1] - a[1]),
      topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCompanies: [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topUsers: [],
      powerStargazers,
      botCount,
      enrichedUserCount,
      isCapped: false,
      organic,
      ...(partial ? { isPartial: true } : {}),
      ...(source ? { source } : {}),
      ...(computedAt ? { computedAt } : {}),
    };

    // A partial response (topCountries/topCities/topCompanies/powerStargazers all
    // empty) must not sit in the CDN cache for the full 5 minutes: that's the
    // window during which a single Neon blip shows an empty stats panel to every
    // client fetching this route directly. 30s/60s caps that propagation to a
    // handful of retries instead of ~300 page loads on a high-traffic repo, while
    // staying well above sub-10s intervals that would fire a fresh (and
    // expensive, up to statement_timeout) query on every request.
    //
    // This header only governs the CDN. The server-rendered path caches through
    // cacheLife() instead, which never reads Cache-Control, so page.tsx has to
    // shorten its own entry on isPartial. Changing one without the other leaves
    // half the traffic on the long TTL.
    // Precomputed responses only change when the refresh cron runs, twice a day, so 15
    // minutes of CDN caching costs nothing in freshness and removes almost all repeat reads.
    const cacheControl = partial
      ? "public, s-maxage=30, stale-while-revalidate=60"
      : source === "precomputed"
        ? "public, s-maxage=900, stale-while-revalidate=3600"
        : "public, s-maxage=300, stale-while-revalidate=600";

    return NextResponse.json(stats, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    logError("stats", err);
    return jsonError("internal", 500);
  }
};
