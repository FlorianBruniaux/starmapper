// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";

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
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }

  const key = normalizeOwnerRepo(owner, repo);

  try {
    const events = await prisma.starEvent.findMany({
      where: key,
      take: 10_000, // cap in-memory aggregation; repos > 10k stars get approximate stats
      select: {
        user: {
          select: {
            login: true, name: true, location: true, company: true, followers: true,
            following: true, publicRepos: true, dataVersion: true, lat: true, lng: true,
          },
        },
      },
    });

    if (!events.length) {
      return jsonError("no_data", 404);
    }

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    const companyCount = new Map<string, number>();
    let followerSum = 0;
    let mappedCount = 0;
    let botCount = 0;
    let enrichedUserCount = 0;

    for (const { user: u } of events) {
      if (u.lat !== null && u.lng !== null) mappedCount++;

      const { country, city } = parseLocation(u.location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + 1);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
      if (u.company) companyCount.set(u.company, (companyCount.get(u.company) ?? 0) + 1);
      followerSum += u.followers;

      if (u.dataVersion >= 1) {
        enrichedUserCount++;
        if (u.followers < 5 && u.following < 5 && u.publicRepos < 2) botCount++;
      }
    }

    const total = events.length;
    const allMapped = events.map(({ user: u }) => ({
      login: u.login,
      name: u.name,
      followers: u.followers,
      publicRepos: u.publicRepos,
      location: u.location,
      avatarUrl: `https://github.com/${u.login}.png`,
      company: u.company,
    }));
    // Keep top 30 by followers + top 30 by publicRepos, deduplicated, max 60 users
    const byFollowers = [...allMapped].sort((a, b) => b.followers - a.followers).slice(0, 30);
    const byRepos = [...allMapped].sort((a, b) => b.publicRepos - a.publicRepos).slice(0, 30);
    const seen = new Set<string>();
    const topUsers = [...byFollowers, ...byRepos].filter(({ login }) => seen.has(login) ? false : (seen.add(login), true));

    // Power stargazers: users who starred multiple repos tracked by StarMapper
    // Uses a subquery to avoid passing up to 10k logins as IN parameters
    const crossRepoGroups = await prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
      SELECT se.login, COUNT(*) AS cnt
      FROM star_event se
      WHERE se.login IN (
        SELECT login FROM star_event WHERE owner = ${key.owner} AND repo = ${key.repo}
      )
      GROUP BY se.login
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 50
    `;
    const userMap = new Map(events.map((e) => [e.user.login, e.user]));
    const powerStargazers = crossRepoGroups
      .slice(0, 20)
      .map((d) => {
        const u = userMap.get(d.login);
        return {
          login: d.login,
          name: u?.name ?? null,
          followers: u?.followers ?? 0,
          trackedRepos: Number(d.cnt),
          avatarUrl: `https://github.com/${d.login}.png`,
        };
      });

    const stats: RepoStats = {
      totalStars: total,
      mappedCount,
      mappingRate: total > 0 ? Math.round((mappedCount / total) * 100) : 0,
      avgFollowers: total > 0 ? Math.round(followerSum / total) : 0,
      countryCount: countryCount.size,
      topCountries: [...countryCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCompanies: [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topUsers,
      powerStargazers,
      botCount,
      enrichedUserCount,
      isCapped: total === 10_000,
    };

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[stats] Error:", err);
    return jsonError("internal", 500);
  }
};
