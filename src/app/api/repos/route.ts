// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchReposData } from "@/lib/repos-query";
import type { RepoItem } from "@/lib/repos-query";
import { jsonError, logError } from "@/lib/api-helpers";

// Re-exported for consumers that already import MappedRepo from this route.
export type { RepoItem as MappedRepo } from "@/lib/repos-query";

export type ReposResponse = {
  repos: RepoItem[];
  total: number;
};

// Cache-key quantisation. fetchReposData() carries "use cache", so its arguments are
// part of the cache key: an unbounded `limit` mints one multi-hundred-KB entry per
// distinct integer (?limit=1, ?limit=2, ...). Snapping up to a five-rung ladder caps
// the entry count at five, and slicing afterwards keeps the response byte-identical
// to what an exact limit would have returned.
//
// Equivalence holds on the diverse path too: repos-query.ts orders by updatedAt DESC
// and stops at `limit`, so a larger pool is an ordered superset and the first N
// retained rows are the same.
//
// Rejecting off-ladder values is not an option: mcp/src/tools/list_repos.ts forwards
// any integer up to 200, and its output prints every row it receives.
const LIMIT_LADDER = [12, 50, 200, 500, 5000] as const;
const MAX_LIMIT = LIMIT_LADDER[LIMIT_LADDER.length - 1];

const quantiseLimit = (limit: number): number =>
  LIMIT_LADDER.find((rung) => rung >= limit) ?? MAX_LIMIT;

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    // parseInt("abc") is NaN, and the previous Math.min(NaN, 10000) forwarded NaN
    // straight into the raw LIMIT clause. Number.isFinite closes that.
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
      : 500;
    const diverse = url.searchParams.get("diverse") === "true";

    const { repos, total } = await fetchReposData(
      quantiseLimit(limit),
      diverse,
    );

    return NextResponse.json(
      { repos: repos.slice(0, limit), total } satisfies ReposResponse,
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    // Re-throw Next.js prerender interrupts (NEXT_PRERENDER_INTERRUPTED) so the
    // framework can bail out to dynamic rendering when req.url is accessed.
    if (err instanceof Error && "digest" in err) throw err;
    logError("repos", err);
    return jsonError("internal", 500);
  }
};
