// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { jsonError, logError } from "@/lib/api-helpers";

export type UserRepo = {
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  url: string;
};

export type UserReposResponse = {
  repos: UserRepo[];
  totalRepos: number;
};

export const GET = async (req: NextRequest) => {
  const login = new URL(req.url).searchParams.get("login") ?? "";
  if (!login) return jsonError("missing login", 400);

  const token = process.env.GITHUB_TOKEN ?? "";
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "StarMapper/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    // Fetch user profile + repos in parallel
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers }),
      fetch(
        `https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=stars&per_page=10&type=owner`,
        { headers },
      ),
    ]);

    if (!reposRes.ok) return jsonError("github_error", reposRes.status === 404 ? 404 : 502);

    const [userData, rawRepos] = await Promise.all([
      userRes.ok ? (userRes.json() as Promise<{ public_repos: number }>) : Promise.resolve(null),
      reposRes.json() as Promise<{
        name: string;
        full_name: string;
        description: string | null;
        stargazers_count: number;
        language: string | null;
        html_url: string;
        fork: boolean;
      }[]>,
    ]);

    const totalRepos = userData?.public_repos ?? 0;

    const repos: UserRepo[] = rawRepos
      .filter((r) => !r.fork)
      .slice(0, 8)
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
        url: r.html_url,
      }));

    return NextResponse.json(
      { repos, totalRepos } satisfies UserReposResponse,
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    logError("explore/user-repos", err);
    return jsonError("internal", 500);
  }
};
