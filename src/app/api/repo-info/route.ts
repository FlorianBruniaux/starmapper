// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
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
    if (!res.ok) return jsonError("Repo not found", 404);
    const data = await res.json();
    return NextResponse.json({
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      language: data.language,
      avatar: data.owner?.avatar_url,
    });
  } catch {
    return jsonError("Failed to reach GitHub", 502);
  }
}
