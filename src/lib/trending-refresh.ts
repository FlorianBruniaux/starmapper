// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Lightweight star-event rescan that keeps the Trending feed alive without depending
// on organic scan traffic. For each target repo it fetches only the stargazers newer
// than a sliding window (fetchStargazersPage stops at the `since` boundary), upserts
// FK-satisfying minimal user rows, then inserts the new star_events. No geocoding —
// trending only needs star_event counts, not map points.

import { prisma } from "@/lib/db";
import { fetchStargazersPage } from "@/lib/github";
import { bulkInsertUsersMinimal, bulkUpsertStarEvents, type MinimalUserInput } from "@/lib/user-cache";
import type { checkDbHealth } from "@/lib/db-health";

type Health = Awaited<ReturnType<typeof checkDbHealth>>;

// Sliding window for "recent stars" — matches the MV's 30-day entry gate.
export const TRENDING_WINDOW_DAYS = 30;
// Safety cap: 20 pages × 100 = 2000 recent stars per repo, bounds GitHub quota per run.
const MAX_PAGES_PER_REPO = 20;
// Candidate universe: curated watchlist ∪ this many top scanned repos, by totalCount.
const TOP_SCANNED_CANDIDATES = 300;

export type RefreshTarget = { owner: string; repo: string };

// Owner/repo are normalized lowercase so star_event rows join badge_cache (lowercase keys).
const normalize = (t: RefreshTarget): RefreshTarget => ({
  owner: t.owner.toLowerCase().trim(),
  repo: t.repo.toLowerCase().trim(),
});

// Fetch recent stargazers for one repo and persist them as star_events.
// Returns the number of new events inserted (createMany skipDuplicates → idempotent).
export const refreshRepoStarEvents = async (
  target: RefreshTarget,
  health: Health,
  windowDays: number = TRENDING_WINDOW_DAYS,
): Promise<{ eventsAdded: number; pages: number }> => {
  const { owner, repo } = normalize(target);
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  let cursor: string | null = null;
  let pages = 0;
  let totalCount = 0;
  const users: MinimalUserInput[] = [];
  const events: { login: string; owner: string; repo: string; starredAt: string }[] = [];

  do {
    const page = await fetchStargazersPage(owner, repo, cursor, since);
    pages++;
    totalCount = page.totalCount;
    for (const sg of page.stargazers) {
      users.push({
        login: sg.login,
        name: sg.name,
        company: sg.company,
        location: sg.location,
        followers: sg.followers,
        following: sg.following,
        publicRepos: sg.publicRepos,
        accountCreatedAt: sg.accountCreatedAt,
      });
      events.push({ login: sg.login, owner, repo, starredAt: sg.starredAt });
    }
    cursor = page.nextCursor;
  } while (cursor && pages < MAX_PAGES_PER_REPO);

  // Users first — star_event.login has a FK to github_user.
  if (users.length) await bulkInsertUsersMinimal(users, health);
  if (events.length) await bulkUpsertStarEvents(events, health);

  // Ensure a badge_cache row exists so the repo can pass the MV join (which requires
  // totalCount >= 50). Update totalCount only — never clobber mappedCount/countryCount
  // written by a real scan. Watchlist repos never scanned get a minimal row here.
  if (totalCount > 0) {
    await prisma.badgeCache.upsert({
      where: { owner_repo: { owner, repo } },
      update: { totalCount },
      create: { owner, repo, totalCount, mappedCount: 0, countryCount: 0 },
    });
  }

  return { eventsAdded: events.length, pages };
};

// Pick the `limit` least-recently-refreshed repos from the candidate universe
// (watchlist ∪ top scanned). Repos never refreshed (no ledger row) come first.
export const selectRefreshTargets = async (limit: number): Promise<RefreshTarget[]> => {
  const rows = await prisma.$queryRaw<RefreshTarget[]>`
    WITH candidates AS (
      SELECT owner, repo FROM trending_watchlist
      UNION
      SELECT owner, repo FROM (
        SELECT owner, repo FROM badge_cache
        WHERE "totalCount" >= 50
        ORDER BY "totalCount" DESC
        LIMIT ${TOP_SCANNED_CANDIDATES}
      ) top
    )
    SELECT c.owner, c.repo
    FROM candidates c
    LEFT JOIN trending_refresh tr ON tr.owner = c.owner AND tr.repo = c.repo
    ORDER BY tr."lastRefreshedAt" ASC NULLS FIRST
    LIMIT ${limit}
  `;
  return rows;
};

// Stamp the refresh ledger so rotation advances to the next-oldest repos next run.
export const recordRefresh = async (target: RefreshTarget, eventsAdded: number): Promise<void> => {
  const { owner, repo } = normalize(target);
  await prisma.trendingRefresh.upsert({
    where: { owner_repo: { owner, repo } },
    update: { lastRefreshedAt: new Date(), eventsAdded },
    create: { owner, repo, lastRefreshedAt: new Date(), eventsAdded },
  });
};
