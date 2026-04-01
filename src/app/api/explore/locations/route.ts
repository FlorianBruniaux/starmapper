// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";
import { jsonError, logError } from "@/lib/api-helpers";

export type LocationsResponse = {
  items: [string, number][];
  total: number;
  page: number;
  pageSize: number;
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page    = Math.min(20, Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10)));
  const size    = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const type    = searchParams.get("type") === "city" ? "city" : "country";
  const country = searchParams.get("country") ?? "";

  try {
    const locationGroups = await prisma.gitHubUser.groupBy({
      by: ["location"],
      _count: { location: true },
      where: { location: { not: null } },
      orderBy: { _count: { location: "desc" } },
      take: 300,
    });

    const aggregated = new Map<string, number>();
    for (const { location, _count } of locationGroups) {
      const n = _count.location;
      const parsed = parseLocation(location);
      if (type === "country") {
        if (parsed.country) aggregated.set(parsed.country, (aggregated.get(parsed.country) ?? 0) + n);
      } else {
        // city: optionally filter by country
        if (country && parsed.country?.toLowerCase() !== country.toLowerCase()) continue;
        if (parsed.city) aggregated.set(parsed.city, (aggregated.get(parsed.city) ?? 0) + n);
      }
    }

    const sorted: [string, number][] = [...aggregated.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.length;
    const items = sorted.slice((page - 1) * size, page * size);

    return NextResponse.json(
      { items, total, page, pageSize: size } satisfies LocationsResponse,
      {
        headers: country
          ? { "Cache-Control": "no-store" }
          : { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
      },
    );
  } catch (err) {
    logError("explore/locations", err);
    return jsonError("internal", 500);
  }
};
