// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchTrendingMap } from "@/lib/trending-query";
import type { StargazerPoint } from "@/app/api/chunk/route";

export type TrendingMapResponse = {
  mapPoints: StargazerPoint[];
};

export const GET = async () => {
  try {
    const mapPoints = await fetchTrendingMap();

    return NextResponse.json(
      { mapPoints } satisfies TrendingMapResponse,
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } },
    );
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
