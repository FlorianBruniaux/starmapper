// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type GrowthWeek = {
  week: string;   // ISO date of Monday (YYYY-MM-DD)
  count: number;  // stars that week
};

export type GrowthResponse = {
  weeks: GrowthWeek[];
  total: number;          // total star_events for this repo
  withTimestamps: number; // how many have a starredAt value
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(owner, repo);

  try {
    const [weekRows, countRow] = await Promise.all([
      prisma.$queryRaw<{ week: string; count: number }[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('week', "starredAt"), 'YYYY-MM-DD') AS week,
          COUNT(*)::int AS count
        FROM star_event
        WHERE owner     = ${key.owner}
          AND repo      = ${key.repo}
          AND "starredAt" IS NOT NULL
        GROUP BY DATE_TRUNC('week', "starredAt")
        ORDER BY week ASC
      `,
      prisma.$queryRaw<{ total: bigint; with_ts: bigint }[]>`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "starredAt" IS NOT NULL) AS with_ts
        FROM star_event
        WHERE owner = ${key.owner} AND repo = ${key.repo}
      `,
    ]);

    if (!countRow[0] || Number(countRow[0].total) === 0) {
      return jsonError("no_data", 404);
    }

    const result: GrowthResponse = {
      weeks: weekRows.map((r) => ({ week: r.week, count: Number(r.count) })),
      total: Number(countRow[0].total),
      withTimestamps: Number(countRow[0].with_ts),
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("stats/growth", err);
    return jsonError("internal", 500);
  }
};
