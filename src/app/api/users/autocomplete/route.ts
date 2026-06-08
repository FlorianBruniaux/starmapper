// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logError, jsonError } from "@/lib/api-helpers";

export type UserAutocompleteItem = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

type GhSearchItem = {
  login: string;
  avatar_url: string;
  type: string;
};

export const GET = async (req: NextRequest) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().substring(0, 50);
  if (!q || q.length < 2) return jsonError("invalid_query", 400);

  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "StarMapper/1.0",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=8`;
    const res = await fetch(url, { headers, next: { revalidate: 60 } });

    if (!res.ok) {
      logError("users/autocomplete", new Error(`GitHub search ${res.status}`));
      return jsonError("upstream_error", 502);
    }

    const data = await res.json() as { items: GhSearchItem[] };
    const items: UserAutocompleteItem[] = (data.items ?? [])
      .filter((i) => i.type === "User")
      .slice(0, 8)
      .map((i) => ({
        login: i.login,
        name: null,
        avatarUrl: i.avatar_url,
      }));

    return NextResponse.json(items, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    logError("users/autocomplete", err);
    return jsonError("internal", 500);
  }
};
