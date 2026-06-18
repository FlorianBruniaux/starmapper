// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/contributors/[owner]/[repo]
// MCP-optimised endpoint: returns top 50 contributors fetched live from GitHub.
// Works headless (no browser cache dependency). Optional ?withLocations=1 param
// enriches each contributor with their GitHub location via a second GraphQL call.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError, extractGhToken } from "@/lib/api-helpers";
import {
  fetchContributorsPage,
  fetchContributorLocations,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";

const TOP_N = 50;

export type McpContributorsResponse = {
  contributors: Array<{
    login: string;
    contributions: number;
    location: string | null;
    profileUrl: string;
  }>;
  shownCount: number;
  hasMore: boolean;
  computing: boolean;
  fetchedAt: string;
  mapUrl: string;
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  const key = validateOwnerRepo(rawOwner, rawRepo);
  if (!key) return jsonError("invalid_params", 400);

  const withLocations = req.nextUrl.searchParams.get("withLocations") === "1";
  const clientToken = extractGhToken(req);

  try {
    const page = await fetchContributorsPage(key.owner, key.repo, 1, clientToken);

    if (page.computing) {
      const response: McpContributorsResponse = {
        contributors: [],
        shownCount: 0,
        hasMore: false,
        computing: true,
        fetchedAt: new Date().toISOString(),
        mapUrl: `https://starmapper.bruniaux.com/${key.owner}/${key.repo}`,
      };
      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const top = page.contributors.slice(0, TOP_N);

    let locationMap = new Map<string, string | null>();
    if (withLocations && top.length > 0) {
      const logins = top.map((c) => c.login);
      locationMap = await fetchContributorLocations(logins, clientToken);
    }

    const response: McpContributorsResponse = {
      contributors: top.map((c) => ({
        login: c.login,
        contributions: c.contributions,
        // fetchContributorLocations keys by raw login (not lowercased)
        location: withLocations ? (locationMap.get(c.login) ?? null) : null,
        profileUrl: `https://github.com/${c.login}`,
      })),
      shownCount: top.length,
      hasMore: page.hasMore,
      computing: false,
      fetchedAt: new Date().toISOString(),
      mapUrl: `https://starmapper.bruniaux.com/${key.owner}/${key.repo}`,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  } catch (err) {
    if (err instanceof GitHubTokenInvalidError) return jsonError("token_invalid", 401);
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", resetAt: err.resetAt },
        { status: 429 },
      );
    }
    logError("api/mcp/contributors GET", err);
    return jsonError("internal", 500);
  }
};
