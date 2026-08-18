// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Extracted from src/app/api/profile/[login]/route.ts so /profile/[login] can call it
// directly instead of fetching its own public URL. Same pattern as src/lib/devs-query.ts.
//
// The return type is a discriminated union rather than `ProfileResponse | null` on purpose:
// collapsing it would erase the 400-vs-404 distinction, and a malformed login has to stay
// a 400 for the route.

import { prisma } from "@/lib/db";
import { LOGIN_RE } from "@/lib/api-validation";

export type ProfileRepo = {
  owner: string;
  repo: string;
  totalCount: number;
  mappedCount: number;
  language: string | null;
  starredAt: string | null; // ISO — null for owned repos
};

export type ProfileResponse = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  publicRepos: number;
  lat: number | null;
  lng: number | null;
  countryNormalized: string | null;
  cityNormalized: string | null;
  languages: string[];
  linkedinUrl: string | null;
  ownedRepos: ProfileRepo[];
  starredRepos: ProfileRepo[];
  starredCount: number;
  // true when the user is only known via badge_cache (repo owner, not a tracked stargazer)
  partial: boolean;
};

export type ProfileResult =
  | { ok: true; profile: ProfileResponse }
  | { ok: false; error: "invalid_params"; status: 400 }
  | { ok: false; error: "not_found"; status: 404 };

const BADGE_SELECT = {
  owner: true,
  repo: true,
  totalCount: true,
  mappedCount: true,
  language: true,
} as const;

type BadgeRow = {
  owner: string;
  repo: string;
  totalCount: number;
  mappedCount: number;
  language: string | null;
};

const toOwnedRepo = (r: BadgeRow): ProfileRepo => ({
  owner: r.owner,
  repo: r.repo,
  totalCount: r.totalCount,
  mappedCount: r.mappedCount,
  language: r.language ?? null,
  starredAt: null,
});

export const fetchProfile = async (login: string): Promise<ProfileResult> => {
  if (!LOGIN_RE.test(login))
    return { ok: false, error: "invalid_params", status: 400 };

  // Step 1 — resolve canonical login.
  // Use an IN clause over casing variants (exact, lowercase, titlecase) — each hits the btree
  // PK index. Ordered by followers DESC so that when duplicate rows exist with different
  // casings, the most complete record wins. Avoids ILIKE which causes a full table scan.
  const loginVariants = [
    ...new Set([
      login,
      login.toLowerCase(),
      login.charAt(0).toUpperCase() + login.slice(1).toLowerCase(),
    ]),
  ];
  const user = await prisma.gitHubUser.findFirst({
    where: { login: { in: loginVariants } },
    orderBy: [{ followers: "desc" }, { fetchedAt: "desc" }],
    select: {
      login: true,
      name: true,
      company: true,
      location: true,
      followers: true,
      publicRepos: true,
      lat: true,
      lng: true,
      countryNormalized: true,
      cityNormalized: true,
      languages: true,
      linkedinUrl: true,
    },
  });

  // Partial profile path — user is a repo owner but not a tracked stargazer
  if (!user) {
    const ownedRaw = await prisma.badgeCache.findMany({
      where: { owner: login.toLowerCase() },
      select: BADGE_SELECT,
      orderBy: { totalCount: "desc" },
      take: 50,
    });

    if (ownedRaw.length === 0)
      return { ok: false, error: "not_found", status: 404 };

    return {
      ok: true,
      profile: {
        // Canonical owner casing comes from the first badge_cache row
        login: ownedRaw[0].owner,
        name: null,
        company: null,
        location: null,
        followers: 0,
        publicRepos: 0,
        lat: null,
        lng: null,
        countryNormalized: null,
        cityNormalized: null,
        languages: [],
        linkedinUrl: null,
        ownedRepos: ownedRaw.map(toOwnedRepo),
        starredRepos: [],
        starredCount: 0,
        partial: true,
      },
    };
  }

  // Full profile path
  const canonicalLogin = user.login;

  // Step 2 — owned repos + starred events in parallel (using canonical casing)
  const [ownedRaw, starredEvents, starredCount] = await Promise.all([
    // badge_cache stores owner in lowercase
    prisma.badgeCache.findMany({
      where: { owner: canonicalLogin.toLowerCase() },
      select: BADGE_SELECT,
      orderBy: { totalCount: "desc" },
      take: 50,
    }),
    // Starred repos step A — @@unique([login, owner, repo]) makes WHERE login = X fast
    prisma.starEvent.findMany({
      where: { login: canonicalLogin },
      select: { owner: true, repo: true, starredAt: true },
      orderBy: { starredAt: "desc" },
      take: 100,
    }),
    prisma.starEvent.count({ where: { login: canonicalLogin } }),
  ]);

  // Starred repos step B — enrich with badge_cache in a single batch
  let starredRepos: ProfileRepo[] = [];
  if (starredEvents.length > 0) {
    const badgeMap = new Map<
      string,
      { totalCount: number; mappedCount: number; language: string | null }
    >();

    const badgeRows = await prisma.badgeCache.findMany({
      where: {
        OR: starredEvents.map((e) => ({ owner: e.owner, repo: e.repo })),
      },
      select: BADGE_SELECT,
    });
    for (const b of badgeRows) {
      badgeMap.set(`${b.owner}/${b.repo}`, {
        totalCount: b.totalCount,
        mappedCount: b.mappedCount,
        language: b.language ?? null,
      });
    }

    starredRepos = starredEvents.flatMap((e) => {
      const badge = badgeMap.get(`${e.owner}/${e.repo}`);
      if (!badge) return [];
      return [
        {
          owner: e.owner,
          repo: e.repo,
          totalCount: badge.totalCount,
          mappedCount: badge.mappedCount,
          language: badge.language,
          starredAt: e.starredAt.toISOString(),
        },
      ];
    });
  }

  return {
    ok: true,
    profile: {
      login: user.login,
      name: user.name,
      company: user.company,
      location: user.location,
      followers: user.followers,
      publicRepos: user.publicRepos,
      // Reduce precision to ~1.1 km to prevent individual geolocation
      lat: user.lat != null ? Math.round(user.lat * 100) / 100 : null,
      lng: user.lng != null ? Math.round(user.lng * 100) / 100 : null,
      countryNormalized: user.countryNormalized,
      cityNormalized: user.cityNormalized,
      languages: user.languages,
      linkedinUrl: user.linkedinUrl,
      ownedRepos: ownedRaw.map(toOwnedRepo),
      starredRepos,
      starredCount,
      partial: false,
    },
  };
};
