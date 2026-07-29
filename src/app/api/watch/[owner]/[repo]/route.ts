// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type WatchResult = {
  newCount: number;
  countries: string[];
  logins: string[];
};

type GhStarEntry = {
  starred_at: string;
  user: { login: string };
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  const sinceParam = req.nextUrl.searchParams.get("since");
  let since: Date;
  try {
    since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60_000);
    if (isNaN(since.getTime())) throw new Error("invalid date");
  } catch {
    return jsonError("invalid_params", 400);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return jsonError("no_token", 503);

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${key.owner}/${key.repo}/stargazers?per_page=100&sort=created&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.star+json",
          "User-Agent": "StarMapper/1.0",
        },
        cache: "no-store",
      },
    );

    if (!ghRes.ok) {
      if (ghRes.status === 404) return jsonError("not_found", 404);
      if (ghRes.status === 403 || ghRes.status === 429) return jsonError("rate_limit", 429);
      return jsonError("github_error", 502);
    }

    const ghData = (await ghRes.json()) as GhStarEntry[];
    const newStars = ghData.filter((s) => new Date(s.starred_at) > since);

    if (newStars.length === 0) {
      return NextResponse.json(
        { newCount: 0, countries: [], logins: [] } satisfies WatchResult,
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const logins = newStars.map((s) => s.user.login);

    // Country lookup from our user cache — no Nominatim calls
    const users = await prisma.gitHubUser.findMany({
      where: { login: { in: logins } },
      select: { countryNormalized: true },
    });

    const countries = [...new Set(
      users
        .map((u) => u.countryNormalized)
        .filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined),
    )].slice(0, 5);

    return NextResponse.json(
      { newCount: newStars.length, countries, logins } satisfies WatchResult,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    logError("watch", err);
    return jsonError("internal", 500);
  }
};
