// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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
    let rows: { label: string; cnt: bigint }[];

    if (type === "country") {
      // country_stats_mv pre-aggregates 4.3M rows — reads in ~5ms instead of 9s full scan.
      // Falls back to direct GROUP BY scan if MV is missing (new DB instance, rollback, etc.).
      rows = await prisma.$queryRaw<{ label: string; cnt: bigint }[]>`
        SELECT country AS label, cnt FROM country_stats_mv ORDER BY cnt DESC LIMIT 500
      `.catch(() =>
        prisma.$queryRaw<{ label: string; cnt: bigint }[]>`
          SELECT "countryNormalized" AS label, COUNT(*) AS cnt
          FROM github_user
          WHERE "countryNormalized" IS NOT NULL
            AND "countryNormalized" NOT LIKE 'http%'
          GROUP BY "countryNormalized"
          ORDER BY cnt DESC
          LIMIT 500
        `
      );
    } else if (country) {
      rows = await prisma.$queryRaw<{ label: string; cnt: bigint }[]>`
        SELECT "cityNormalized" AS label, COUNT(*) AS cnt
        FROM github_user
        WHERE "cityNormalized" IS NOT NULL
          AND "countryNormalized" ILIKE ${country}
        GROUP BY "cityNormalized"
        ORDER BY cnt DESC
        LIMIT 500
      `;
    } else {
      rows = await prisma.$queryRaw<{ label: string; cnt: bigint }[]>`
        SELECT "cityNormalized" AS label, COUNT(*) AS cnt
        FROM github_user
        WHERE "cityNormalized" IS NOT NULL
        GROUP BY "cityNormalized"
        ORDER BY cnt DESC
        LIMIT 500
      `;
    }

    const sorted: [string, number][] = rows.map((r) => [r.label, Number(r.cnt)]);
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
