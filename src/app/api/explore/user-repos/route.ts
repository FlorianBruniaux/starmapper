// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { jsonError, logError } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";

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

const CACHE_RESPONSE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };

// 7 days TTL before re-fetching from GitHub
const FRESH_MS = 7 * 24 * 3600 * 1000;

const mapRawRepos = (rawRepos: {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  html_url: string;
  fork: boolean;
}[]): UserRepo[] =>
  rawRepos
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

export const GET = async (req: NextRequest) => {
  const login = new URL(req.url).searchParams.get("login") ?? "";
  if (!login) return jsonError("missing login", 400);

  // 1. DB read — graceful fallback if DB is down
  const dbUser = await prisma.gitHubUser.findUnique({
    where: { login },
    select: { topRepos: true, topReposFetchedAt: true, publicRepos: true },
  }).catch(() => null);

  // 2. Fresh DB hit — return without calling GitHub
  const isFresh =
    dbUser?.topReposFetchedAt != null &&
    Date.now() - dbUser.topReposFetchedAt.getTime() < FRESH_MS;

  if (isFresh && Array.isArray(dbUser!.topRepos)) {
    const cachedRepos = dbUser!.topRepos as UserRepo[];
    const totalRepos = Math.max(dbUser!.publicRepos ?? 0, cachedRepos.length);

    // Self-heal: if publicRepos was never written (old writes only set topRepos),
    // fix it now so the explore leaderboard shows the correct initial count.
    if (cachedRepos.length > (dbUser!.publicRepos ?? 0)) {
      await prisma.gitHubUser.update({
        where: { login },
        data: { publicRepos: cachedRepos.length },
      }).catch((e) => logError("explore/user-repos:heal-public-repos", e));
    }

    return NextResponse.json(
      { repos: cachedRepos, totalRepos } satisfies UserReposResponse,
      { headers: CACHE_RESPONSE_HEADERS },
    );
  }

  // 3. GitHub fetch
  const token = process.env.GITHUB_TOKEN ?? "";
  const ghHeaders: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "StarMapper/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: ghHeaders }),
      fetch(
        `https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=stars&per_page=10&type=owner`,
        { headers: ghHeaders },
      ),
    ]);

    // 404 — mark as fetched-empty so we don't retry on every click
    if (reposRes.status === 404) {
      if (dbUser) {
        await prisma.gitHubUser.update({
          where: { login },
          data: { topRepos: [], topReposFetchedAt: new Date() },
        }).catch(() => {});
      }
      return jsonError("not_found", 404);
    }

    if (!reposRes.ok) return jsonError("github_error", 502);

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

    const repos = mapRawRepos(rawRepos);
    // Take the maximum of all available sources — userData may be null (rate limit / 403 / flake)
    // but repos still returned. Math.max guarantees totalRepos >= repos.length when repos exist.
    const totalRepos = Math.max(
      userData?.public_repos ?? 0,
      dbUser?.publicRepos ?? 0,
      repos.length,
    );

    // 4. Lazy persist — only if user already exists in DB (no phantom upsert)
    // publicRepos is strictly increasing to avoid regressions.
    if (dbUser) {
      const newPublicRepos = Math.max(
        userData?.public_repos ?? 0,
        dbUser.publicRepos ?? 0,
        repos.length,
      );
      await prisma.gitHubUser.update({
        where: { login },
        data: {
          topRepos: repos,
          topReposFetchedAt: new Date(),
          ...(newPublicRepos > (dbUser.publicRepos ?? 0) ? { publicRepos: newPublicRepos } : {}),
        },
      }).catch((e) => logError("explore/user-repos:persist", e));
    }

    return NextResponse.json(
      { repos, totalRepos } satisfies UserReposResponse,
      { headers: CACHE_RESPONSE_HEADERS },
    );
  } catch (err) {
    logError("explore/user-repos", err);
    return jsonError("internal", 500);
  }
};
