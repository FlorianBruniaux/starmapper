// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, extractGhToken, parseGitHubCountFromLink } from "@/lib/api-helpers";

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const key = validateOwnerRepo(searchParams.get("owner"), searchParams.get("repo"));
  if (!key) return jsonError("Invalid owner/repo format", 400);

  const { owner, repo } = key;
  const token = extractGhToken(req);
  const ghHeaders = {
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    // Core repo fetch — failure here is fatal
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: ghHeaders,
      next: { revalidate: 300, tags: [`repo-info-${owner}-${repo}`] },
    });
    if (res.status === 404) return jsonError("Repo not found", 404);
    if (res.status === 403 || res.status === 429) return jsonError("GitHub rate limit exceeded", 429);
    if (res.status === 401) return jsonError("GitHub token invalid or missing", 401);
    if (!res.ok) return jsonError("GitHub error", 502);
    const data = await res.json();

    // Contributors count — best-effort, never blocks the core response.
    // per_page=1 + Link header gives the total without fetching all pages.
    // Returns null on 202 (stats computing), 403, or network failure.
    const contribRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=0`,
      { headers: ghHeaders },
    ).catch(() => null);
    const contributorsCount = contribRes ? await parseGitHubCountFromLink(contribRes) : null;

    return NextResponse.json({
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      avatar: data.owner?.avatar_url,
      forksCount: data.forks_count as number,
      watchersCount: data.subscribers_count as number,
      contributorsCount,
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return jsonError("Failed to reach GitHub", 502);
  }
}
