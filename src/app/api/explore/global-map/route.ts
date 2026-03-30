// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type GlobalMapCell = {
  lat: number;
  lng: number;
  count: number;
  totalFollowers: number;
  topLogin: string;
};

export type GlobalMapData = {
  cells: GlobalMapCell[];
  totalMapped: number;
};

export const GET = async () => {
  try {
    const rows = await prisma.$queryRaw<
      { grid_lat: number; grid_lng: number; count: number; total_followers: number; top_login: string }[]
    >`
      SELECT
        ROUND(lat::numeric, 0)::float8                               AS grid_lat,
        ROUND(lng::numeric, 0)::float8                               AS grid_lng,
        COUNT(*)::int                                                 AS count,
        COALESCE(SUM(followers), 0)::int                             AS total_followers,
        (ARRAY_AGG(login ORDER BY followers DESC NULLS LAST))[1]     AS top_login
      FROM github_user
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      GROUP BY ROUND(lat::numeric, 0), ROUND(lng::numeric, 0)
    `;

    const cells: GlobalMapCell[] = rows.map((r) => ({
      lat: r.grid_lat,
      lng: r.grid_lng,
      count: r.count,
      totalFollowers: r.total_followers,
      topLogin: r.top_login,
    }));

    const totalMapped = cells.reduce((acc, c) => acc + c.count, 0);

    return NextResponse.json(
      { cells, totalMapped } satisfies GlobalMapData,
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } },
    );
  } catch (err) {
    logError("explore/global-map", err);
    return jsonError("internal", 500);
  }
};
