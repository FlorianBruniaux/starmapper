// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/followers/[login]
// MCP-optimised endpoint: returns the most influential followers of a GitHub user,
// fetched live from GitHub (first page = up to 100), sorted by follower count desc.
// Reports totalCount so callers know the true size when truncated.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateLogin } from "@/lib/api-validation";
import { jsonError, logError, extractGhToken } from "@/lib/api-helpers";
import {
  fetchFollowersPage,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";

export type McpFollowersResponse = {
  login: string;
  followers: Array<{
    login: string;
    name: string | null;
    followers: number;
    company: string | null;
    location: string | null;
    profileUrl: string;
  }>;
  shownCount: number;
  totalCount: number;
  truncated: boolean;
  fetchedAt: string;
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login: rawLogin } = await params;
  const login = validateLogin(rawLogin);
  if (!login) return jsonError("invalid_params", 400);

  const clientToken = extractGhToken(req);

  try {
    // Fetch only the first page (100 followers max) to keep quota cost low.
    // totalCount communicates the true size when the user has more followers.
    const page = await fetchFollowersPage(login, null, clientToken);

    // Sort by follower count descending so the most influential appear first.
    const sorted = page.followers
      .slice()
      .sort((a, b) => b.followers - a.followers);

    const response: McpFollowersResponse = {
      login,
      followers: sorted.map((f) => ({
        login: f.login,
        name: f.name,
        followers: f.followers,
        company: f.company,
        location: f.location,
        profileUrl: `https://github.com/${f.login}`,
      })),
      shownCount: sorted.length,
      totalCount: page.totalCount,
      truncated: page.totalCount > sorted.length,
      fetchedAt: new Date().toISOString(),
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
    logError("api/mcp/followers GET", err);
    return jsonError("internal", 500);
  }
};
