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

// MV refresh is handled by Vercel Cron every 2h via /api/admin/refresh-grid-mv.
// This route is a pure read — no refresh triggered here.
export const GET = async () => {
  try {
    const rows = await prisma.$queryRaw<
      { lat: number; lng: number; count: number; total_followers: number; top_login: string }[]
    >`
      SELECT lat, lng, count, total_followers, top_login
      FROM github_user_grid_mv
      ORDER BY count DESC
    `;

    const cells: GlobalMapCell[] = rows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
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
    // MV missing (42P01) → fall back to direct table scan
    const isMvMissing = err instanceof Error && err.message.includes("42P01");
    if (!isMvMissing) {
      logError("explore/global-map", err);
      return jsonError("internal", 500);
    }

    try {
      const fallbackRows = await prisma.$queryRaw<
        { lat: number; lng: number; count: number; total_followers: number; top_login: string }[]
      >`
        SELECT lat, lng, count, total_followers, top_login FROM (
          SELECT
            ROUND(lat::numeric, 1)::float  AS lat,
            ROUND(lng::numeric, 1)::float  AS lng,
            COUNT(*) OVER (
              PARTITION BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
            )::int AS count,
            SUM(followers) OVER (
              PARTITION BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
            )::int AS total_followers,
            login AS top_login,
            ROW_NUMBER() OVER (
              PARTITION BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
              ORDER BY followers DESC
            ) AS rn
          FROM github_user
          WHERE lat IS NOT NULL AND lng IS NOT NULL
        ) t
        WHERE rn = 1
        ORDER BY count DESC
      `;

      const cells: GlobalMapCell[] = fallbackRows.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        count: r.count,
        totalFollowers: r.total_followers,
        topLogin: r.top_login,
      }));

      const totalMapped = cells.reduce((acc, c) => acc + c.count, 0);

      // No CDN cache on fallback — MV may be created shortly after
      return NextResponse.json({ cells, totalMapped } satisfies GlobalMapData);
    } catch (fallbackErr) {
      logError("explore/global-map/fallback", fallbackErr);
      return jsonError("internal", 500);
    }
  }
};
