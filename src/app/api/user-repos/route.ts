// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { extractGhToken, jsonError } from "@/lib/api-helpers";

export type UserRepo = {
  name: string;
  stars: number;
  description: string | null;
  language: string | null;
  fork: boolean;
  pushedAt: string | null;
};

export type UserInfo = {
  login: string;
  name: string | null;
  avatar: string;
  publicRepos: number;
};

type GhRepo = {
  name: string;
  stargazers_count: number;
  description: string | null;
  language: string | null;
  fork: boolean;
  pushed_at: string | null;
};

type GhUser = {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
};

const USERNAME_RE = /^[a-zA-Z0-9._-]{1,100}$/;

const mapRepo = (r: GhRepo): UserRepo => ({
  name: r.name,
  stars: r.stargazers_count,
  description: r.description,
  language: r.language,
  fork: r.fork,
  pushedAt: r.pushed_at,
});

const parseTotalPages = (link: string): number => {
  const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? parseInt(m[1], 10) : 1;
};

export const GET = async (req: NextRequest) => {
  const username = req.nextUrl.searchParams.get("username") ?? "";
  if (!USERNAME_RE.test(username)) {
    return jsonError("Invalid username", 400);
  }

  const token = extractGhToken(req);
  const ghHeaders: Record<string, string> = {
    "User-Agent": "StarMapper/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) ghHeaders["Authorization"] = `Bearer ${token}`;

  try {
    const [userRes, page1Res] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, {
        headers: ghHeaders,
        next: { revalidate: 120 },
      }),
      fetch(
        `https://api.github.com/users/${username}/repos?type=public&sort=stars&direction=desc&per_page=100&page=1`,
        { headers: ghHeaders, next: { revalidate: 120 } },
      ),
    ]);

    if (userRes.status === 404) {
      return jsonError("User not found", 404);
    }
    if (!userRes.ok || !page1Res.ok) {
      const status = userRes.status === 403 || page1Res.status === 403 ? 403 : 502;
      return jsonError("GitHub API error", status);
    }

    const ghUser = (await userRes.json()) as GhUser;
    const user: UserInfo = {
      login: ghUser.login,
      name: ghUser.name,
      avatar: ghUser.avatar_url,
      publicRepos: ghUser.public_repos,
    };

    const page1Data = (await page1Res.json()) as GhRepo[];
    let repos: UserRepo[] = page1Data.map(mapRepo);

    const totalPages = parseTotalPages(page1Res.headers.get("Link") ?? "");
    if (totalPages > 1) {
      const pageNums = Array.from({ length: Math.min(totalPages - 1, 4) }, (_, i) => i + 2);
      const morePages = await Promise.all(
        pageNums.map((p) =>
          fetch(
            `https://api.github.com/users/${username}/repos?type=public&sort=stars&direction=desc&per_page=100&page=${p}`,
            { headers: ghHeaders, next: { revalidate: 120 } },
          ).then((r) => r.json() as Promise<GhRepo[]>),
        ),
      );
      for (const page of morePages) repos = [...repos, ...page.map(mapRepo)];
    }

    return NextResponse.json(
      { user, repos },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch {
    return jsonError("internal", 500);
  }
};
