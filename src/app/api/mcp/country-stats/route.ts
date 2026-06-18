// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/country-stats
// MCP-optimised endpoint: worldwide stargazer distribution per country across
// all indexed repos. Reads country_stats_mv via fetchTopCountries().
// No auth required. Reflects the last MV refresh (typically within the past hour).

import { NextResponse } from "next/server";
import { jsonError, logError } from "@/lib/api-helpers";
import { fetchTopCountries } from "@/lib/devs-query";

export type McpGlobalCountryStatsResponse = {
  countries: Array<{ name: string; count: number; slug: string }>;
  totalCountries: number;
  totalStargazers: number;
  generatedAt: string;
};

export const GET = async () => {
  try {
    const data = await fetchTopCountries();

    const totalStargazers = data.countries.reduce((sum, c) => sum + c.count, 0);

    const response: McpGlobalCountryStatsResponse = {
      countries: data.countries.map((c) => ({
        name: c.name,
        count: c.count,
        slug: c.slug,
      })),
      totalCountries: data.countries.length,
      totalStargazers,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    logError("api/mcp/country-stats GET", err);
    return jsonError("internal", 500);
  }
};
