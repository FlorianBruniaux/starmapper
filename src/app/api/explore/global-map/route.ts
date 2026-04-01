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

// Refresh the materialized view at most once every 30 minutes (fire-and-forget).
// CONCURRENTLY does not block reads — the old data stays visible until refresh completes.
let _lastGridRefresh = 0;
const GRID_REFRESH_TTL_MS = 30 * 60 * 1000;
const maybeRefreshGridMv = () => {
  const now = Date.now();
  if (now - _lastGridRefresh < GRID_REFRESH_TTL_MS) return;
  _lastGridRefresh = now;
  prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv`
    .catch((err) => logError("global-map/refresh-mv", err));
};

export const GET = async () => {
  void maybeRefreshGridMv();
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
    logError("explore/global-map", err);
    return jsonError("internal", 500);
  }
};
