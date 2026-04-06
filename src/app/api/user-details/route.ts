// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { LOGIN_RE } from "@/lib/api-validation";
import { jsonError, extractGhToken, logError } from "@/lib/api-helpers";

export type UserDetail = {
  login: string;
  name: string | null;
  email: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  twitter_username: string | null;
  followers: number;
  following: number;
  public_repos: number;
  avatarUrl: string;
};

async function fetchUser(login: string, token: string): Promise<UserDetail | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return {
      login: u.login,
      name: u.name ?? null,
      email: u.email ?? null,
      bio: u.bio ?? null,
      company: u.company ? u.company.trim().replace(/^@/, "") : null,
      blog: typeof u.blog === "string" && u.blog.startsWith("https://") ? u.blog : null,
      location: u.location ?? null,
      twitter_username: u.twitter_username ?? null,
      followers: u.followers ?? 0,
      following: u.following ?? 0,
      public_repos: u.public_repos ?? 0,
      avatarUrl: u.avatar_url ?? "",
    };
  } catch {
    return null;
  }
}

export const POST = async (req: NextRequest) => {
  try {
    const { logins } = await req.json() as { logins: string[] };
    if (!Array.isArray(logins) || logins.length === 0)
      return jsonError("Missing logins", 400);
    if (logins.length > 200)
      return jsonError("Max 200 users per request", 400);

    if (!logins.every((l) => typeof l === "string" && LOGIN_RE.test(l)))
      return jsonError("invalid_login", 400);

    const token = extractGhToken(req);
    if (!token) return jsonError("github_token_required", 401);

    // Fetch with concurrency 25 (GitHub REST rate limit is 5000/hr — 200 users is fine)
    const CONCURRENCY = 25;
    const results: UserDetail[] = [];
    for (let i = 0; i < logins.length; i += CONCURRENCY) {
      const batch = logins.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map((l) => fetchUser(l, token)));
      results.push(...fetched.filter((u): u is UserDetail => u !== null));
    }

    return NextResponse.json({ users: results });
  } catch (e) {
    logError("user-details", e);
    return jsonError("internal", 500);
  }
}
