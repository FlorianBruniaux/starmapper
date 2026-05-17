// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, extractGhToken } from "@/lib/api-helpers";

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const key = validateOwnerRepo(searchParams.get("owner"), searchParams.get("repo"));
  if (!key) return jsonError("Invalid owner/repo format", 400);

  const { owner, repo } = key;
  const token = extractGhToken(req);
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 300 },
    });
    if (res.status === 404) return jsonError("Repo not found", 404);
    if (res.status === 403 || res.status === 429) return jsonError("GitHub rate limit exceeded", 429);
    if (res.status === 401) return jsonError("GitHub token invalid or missing", 401);
    if (!res.ok) return jsonError("GitHub error", 502);
    const data = await res.json();
    return NextResponse.json({
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      avatar: data.owner?.avatar_url,
      forksCount: data.forks_count as number,
      watchersCount: data.subscribers_count as number,
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return jsonError("Failed to reach GitHub", 502);
  }
}
