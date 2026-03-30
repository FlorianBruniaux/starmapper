// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { jsonError, logError } from "@/lib/api-helpers";

export type ExploreSummary = {
  totalUsers: number;
  totalTrackedRepos: number;
  totalStarEvents: number;
  totalCountries: number;
  countryList: string[];
};

export const GET = async () => {
  try {
    const [totalUsers, totalStarEvents, totalTrackedRepos, locationGroups] = await Promise.all([
      prisma.gitHubUser.count(),
      prisma.starEvent.count(),
      prisma.badgeCache.count(),
      prisma.gitHubUser.groupBy({
        by: ["location"],
        _count: { location: true },
        where: { location: { not: null } },
        orderBy: { _count: { location: "desc" } },
        take: 5000,
      }),
    ]);

    const countrySet = new Set<string>();
    for (const { location } of locationGroups) {
      const { country } = parseLocation(location);
      if (country) countrySet.add(country);
    }

    const countryList = [...countrySet].sort();

    const data: ExploreSummary = {
      totalUsers,
      totalTrackedRepos,
      totalStarEvents,
      totalCountries: countryList.length,
      countryList,
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (err) {
    logError("explore", err);
    return jsonError("internal", 500);
  }
};
