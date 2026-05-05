// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocode } from "@/lib/geocoder";
import { jsonError, extractGhToken, logError } from "@/lib/api-helpers";
import { LOGIN_RE } from "@/lib/api-validation";

const COOLDOWN_MS = 60 * 60 * 1000; // 1h

export type RefreshResponse = { ok: true; updatedAt: string } | { error: string; retryAfterSec?: number };

const fetchGitHubUserREST = async (login: string, token: string | undefined) => {
  const headers: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "starmapper/1.0" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub REST HTTP ${res.status}`);

  const u = await res.json();
  return {
    name: (u.name as string | null) ?? null,
    company: u.company ? String(u.company).trim().replace(/^@/, "") : null,
    location: (u.location as string | null) ?? null,
    followers: (u.followers as number) ?? 0,
    following: (u.following as number) ?? 0,
    publicRepos: (u.public_repos as number) ?? 0,
  };
};

const fetchLanguagesGraphQL = async (login: string, token: string | undefined): Promise<string[]> => {
  if (!token) return [];

  const query = `query {
    user(login: ${JSON.stringify(login)}) {
      repositories(first: 10, ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}, isFork: false) {
        nodes { primaryLanguage { name } }
      }
    }
  }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "starmapper/1.0",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return [];

  const json = await res.json() as { data?: { user?: { repositories?: { nodes: Array<{ primaryLanguage: { name: string } | null } | null> } } } };
  const nodes = json.data?.user?.repositories?.nodes ?? [];
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const lang = n?.primaryLanguage?.name;
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
};

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  if (!LOGIN_RE.test(login)) return jsonError("invalid_params", 400);

  try {
    // Fast path: exact PK match avoids ILIKE scan on 4M+ rows
    const exactExists = !!(await prisma.gitHubUser.findUnique({
      where: { login },
      select: { login: true },
    }));
    const user = await prisma.gitHubUser.findFirst({
      where: exactExists
        ? { login }
        : { login: { equals: login, mode: "insensitive" } },
      orderBy: exactExists ? undefined : [{ followers: "desc" }, { fetchedAt: "desc" }],
      select: { login: true, location: true, fetchedAt: true, lat: true, lng: true },
    });

    const token = extractGhToken(req);

    // User not in DB — fetch from GitHub and create them on the fly
    if (!user) {
      const [ghData, languages] = await Promise.all([
        fetchGitHubUserREST(login, token),
        fetchLanguagesGraphQL(login, token),
      ]);
      if (!ghData) return jsonError("github_not_found", 404);

      let lat: number | null = null;
      let lng: number | null = null;
      if (ghData.location) {
        const coords = await geocode(ghData.location);
        lat = coords?.[0] ?? null;
        lng = coords?.[1] ?? null;
      }

      const now = new Date();
      await prisma.gitHubUser.create({
        data: {
          login,
          name: ghData.name,
          company: ghData.company,
          location: ghData.location,
          followers: ghData.followers,
          following: ghData.following,
          publicRepos: ghData.publicRepos,
          lat,
          lng,
          fetchedAt: now,
          ...(languages.length > 0 ? { languages, languagesFetchedAt: now } : {}),
        },
      });

      return NextResponse.json<RefreshResponse>({ ok: true, updatedAt: now.toISOString() });
    }

    // Cooldown: prevent hammering GitHub API for the same user
    const elapsed = Date.now() - new Date(user.fetchedAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      return NextResponse.json<RefreshResponse>(
        { error: "cooldown", retryAfterSec },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
      );
    }

    const [ghData, languages] = await Promise.all([
      fetchGitHubUserREST(user.login, token),
      fetchLanguagesGraphQL(user.login, token),
    ]);

    if (!ghData) return jsonError("github_not_found", 404);

    // Re-geocode only if location string changed
    let lat = user.lat;
    let lng = user.lng;
    if (ghData.location && ghData.location !== user.location) {
      const coords = await geocode(ghData.location);
      lat = coords?.[0] ?? null;
      lng = coords?.[1] ?? null;
    } else if (!ghData.location) {
      lat = null;
      lng = null;
    }

    const now = new Date();
    await prisma.gitHubUser.update({
      where: { login: user.login },
      data: {
        name: ghData.name,
        company: ghData.company,
        location: ghData.location,
        followers: ghData.followers,
        following: ghData.following,
        publicRepos: ghData.publicRepos,
        lat,
        lng,
        fetchedAt: now,
        ...(languages.length > 0 ? { languages, languagesFetchedAt: now } : {}),
      },
    });

    return NextResponse.json<RefreshResponse>({ ok: true, updatedAt: now.toISOString() });
  } catch (err) {
    logError("profile/refresh", err);
    return jsonError("internal", 500);
  }
};
