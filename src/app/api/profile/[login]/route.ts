// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

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

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(login)) {
    return jsonError("invalid_params", 400);
  }

  try {
    // Step 1 — resolve canonical login.
    // Fast path: exact PK lookup first (O(1)); avoids ILIKE full-table scan on 4M+ rows.
    // Only fall back to case-insensitive ILIKE when the URL casing doesn't match the DB.
    const exactExists = !!(await prisma.gitHubUser.findUnique({
      where: { login },
      select: { login: true },
    }));
    const user = await prisma.gitHubUser.findFirst({
      where: exactExists
        ? { login }
        : { login: { equals: login, mode: "insensitive" } },
      orderBy: exactExists ? undefined : [{ followers: "desc" }, { fetchedAt: "desc" }],
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
        select: { owner: true, repo: true, totalCount: true, mappedCount: true, language: true },
        orderBy: { totalCount: "desc" },
        take: 50,
      });

      if (ownedRaw.length === 0) {
        return jsonError("not_found", 404);
      }

      const ownedRepos: ProfileRepo[] = ownedRaw.map((r) => ({
        owner: r.owner,
        repo: r.repo,
        totalCount: r.totalCount,
        mappedCount: r.mappedCount,
        language: r.language ?? null,
        starredAt: null,
      }));

      // Use the canonical owner casing from the first badge_cache row
      const canonicalLogin = ownedRaw[0].owner;

      const partial: ProfileResponse = {
        login: canonicalLogin,
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
        ownedRepos,
        starredRepos: [],
        starredCount: 0,
        partial: true,
      };

      return NextResponse.json(partial, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }

    // Full profile path
    const canonicalLogin = user.login;

    // Step 2 — owned repos + starred events in parallel (using canonical casing)
    const [ownedRaw, starredEvents, starredCount] = await Promise.all([
      // badge_cache stores owner in lowercase
      prisma.badgeCache.findMany({
        where: { owner: canonicalLogin.toLowerCase() },
        select: { owner: true, repo: true, totalCount: true, mappedCount: true, language: true },
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
      const badgeMap = new Map<string, { totalCount: number; mappedCount: number; language: string | null }>();

      const badgeRows = await prisma.badgeCache.findMany({
        where: { OR: starredEvents.map((e) => ({ owner: e.owner, repo: e.repo })) },
        select: { owner: true, repo: true, totalCount: true, mappedCount: true, language: true },
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
        return [{
          owner: e.owner,
          repo: e.repo,
          totalCount: badge.totalCount,
          mappedCount: badge.mappedCount,
          language: badge.language,
          starredAt: e.starredAt.toISOString(),
        }];
      });
    }

    const ownedRepos: ProfileRepo[] = ownedRaw.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      totalCount: r.totalCount,
      mappedCount: r.mappedCount,
      language: r.language ?? null,
      starredAt: null,
    }));

    const profile: ProfileResponse = {
      login: user.login,
      name: user.name,
      company: user.company,
      location: user.location,
      followers: user.followers,
      publicRepos: user.publicRepos,
      lat: user.lat,
      lng: user.lng,
      countryNormalized: user.countryNormalized,
      cityNormalized: user.cityNormalized,
      languages: user.languages,
      linkedinUrl: user.linkedinUrl,
      ownedRepos,
      starredRepos,
      starredCount,
      partial: false,
    };

    return NextResponse.json(profile, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("profile", err);
    return jsonError("internal", 500);
  }
};
