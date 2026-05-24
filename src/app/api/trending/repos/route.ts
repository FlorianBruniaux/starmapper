// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchTrendingRepos } from "@/lib/trending-query";

// Re-exported for consumers that already import from this route.
export type { TrendingRepo } from "@/lib/trending-query";

export type TrendingReposResponse = {
  repos: import("@/lib/trending-query").TrendingRepo[];
  meta: { total: number };
};

export const GET = async () => {
  try {
    const result = await fetchTrendingRepos();

    if (!result) {
      return NextResponse.json(
        { error: "trending_mv_empty", message: "Run pnpm create:trending-mv to initialize." },
        { status: 503 },
      );
    }

    return NextResponse.json(result satisfies TrendingReposResponse, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
