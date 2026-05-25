// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchReposData } from "@/lib/repos-query";
import type { RepoItem } from "@/lib/repos-query";
import { jsonError } from "@/lib/api-helpers";

// Re-exported for consumers that already import MappedRepo from this route.
export type { RepoItem as MappedRepo } from "@/lib/repos-query";

export type ReposResponse = {
  repos: RepoItem[];
  total: number;
};

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 10000) : 500;
    const diverse = url.searchParams.get("diverse") === "true";

    const { repos, total } = await fetchReposData(limit, diverse);

    return NextResponse.json({ repos, total } satisfies ReposResponse, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    // Re-throw Next.js prerender interrupts (NEXT_PRERENDER_INTERRUPTED) so the
    // framework can bail out to dynamic rendering when req.url is accessed.
    if (err instanceof Error && "digest" in err) throw err;
    console.error("[repos] error", err);
    return jsonError("internal", 500);
  }
};
