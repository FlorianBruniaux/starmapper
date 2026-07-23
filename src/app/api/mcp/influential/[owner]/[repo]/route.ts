// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/influential/[owner]/[repo]?minFollowers=500
// Public endpoint (no auth gate) for MCP and automation use.
// Returns enriched stargazers above a follower threshold for the given repo.
// Hard-capped at 50 results to prevent bulk scraping.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export const maxDuration = 30;

export type McpInfluentialUser = {
  login: string;
  name: string | null;
  followers: number;
  location: string | null;
  profileUrl: string;
  avatarUrl: string;
};

export type McpInfluentialResponse = {
  users: McpInfluentialUser[];
  total: number;
  minFollowers: number;
  timedOut?: boolean;
};

const DEFAULT_MIN_FOLLOWERS = 500;
const RESULT_CAP = 50;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  const minFollowersParam = req.nextUrl.searchParams.get("minFollowers");
  const minFollowers = minFollowersParam ? parseInt(minFollowersParam, 10) : DEFAULT_MIN_FOLLOWERS;
  if (isNaN(minFollowers) || minFollowers < 0 || minFollowers > 1_000_000) {
    return jsonError("invalid_min_followers", 400);
  }

  try {
    let rows: {
      login: string;
      name: string | null;
      followers: number;
      location: string | null;
    }[];

    try {
      rows = await prisma.$queryRaw`
        SELECT u.login, u.name, u.followers, u.location
        FROM star_event se
        JOIN github_user u USING (login)
        WHERE se.owner = ${key.owner}
          AND se.repo  = ${key.repo}
          AND u.followers >= ${minFollowers}
          AND u."dataVersion" >= 1
        ORDER BY u.followers DESC
        LIMIT ${RESULT_CAP}
      `;
    } catch (err) {
      // P2010 = raw query failed (statement_timeout from Neon)
      // P2024 = connection pool exhausted (burst traffic before index exists)
      const isOverload =
        err != null &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "P2010" || err.code === "P2024");
      if (!isOverload) throw err;
      // Repo identity goes in the tag, not as a second arg: logError() calls
      // sanitizeError(err), which stringifies a plain object to "[object Object]".
      logError(`mcp/influential timeout [${key.owner}/${key.repo}]`, err);
      const response: McpInfluentialResponse = { users: [], total: 0, minFollowers, timedOut: true };
      return NextResponse.json(response, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const users: McpInfluentialUser[] = rows.map((u) => ({
      login: u.login,
      name: u.name,
      followers: u.followers,
      location: u.location,
      profileUrl: `https://github.com/${u.login}`,
      avatarUrl: `https://github.com/${u.login}.png`,
    }));

    const response: McpInfluentialResponse = { users, total: users.length, minFollowers };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/mcp/influential GET", err);
    return jsonError("internal", 500);
  }
};
