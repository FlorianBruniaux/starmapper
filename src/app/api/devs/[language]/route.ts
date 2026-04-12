// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";
import { slugToLanguage } from "@/lib/languages";

export type LanguageMapCell = {
  lat: number;
  lng: number;
  count: number;
  topLogin: string;
};

export type LanguageTopCountry = {
  country: string;
  count: number;
};

export type LanguageMapData = {
  language: string;
  cells: LanguageMapCell[];
  totalMapped: number;
  topCountries: LanguageTopCountry[];
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ language: string }> },
) => {
  const { language: slug } = await params;

  const language = slugToLanguage(slug);
  if (!language) {
    return jsonError("Unknown language", 404);
  }

  try {
    // Grid aggregation: round lat/lng to 1 decimal (~11km buckets) and count devs per cell.
    // GIN index on github_user.languages makes the ANY() filter fast.
    // language is already validated against the whitelist above — $queryRawUnsafe is safe here.
    const [gridRows, countryRows] = await Promise.all([
      // Try MV first (sub-second) — fall back to direct scan if MV not yet created
      prisma.$queryRawUnsafe<{ lat: number; lng: number; count: number; topLogin: string }[]>(`
        SELECT lat, lng, cnt AS count, top_login AS "topLogin"
        FROM language_grid_mv
        WHERE lang = $1
        ORDER BY cnt DESC
      `, language).catch(() =>
        prisma.$queryRawUnsafe<{ lat: number; lng: number; count: number; topLogin: string }[]>(`
          SELECT
            ROUND(lat::numeric, 1)::float  AS lat,
            ROUND(lng::numeric, 1)::float  AS lng,
            COUNT(*)::int                  AS count,
            (array_agg(login ORDER BY followers DESC))[1] AS "topLogin"
          FROM github_user
          WHERE languages @> ARRAY[$1]::text[]
            AND lat IS NOT NULL
            AND lng IS NOT NULL
          GROUP BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
          ORDER BY count DESC
        `, language)
      ),
      prisma.$queryRawUnsafe<{ country: string; count: number }[]>(`
        SELECT
          "countryNormalized" AS country,
          COUNT(*)::int       AS count
        FROM github_user
        WHERE languages @> ARRAY[$1]::text[]
          AND "countryNormalized" IS NOT NULL
          AND "countryNormalized" NOT LIKE 'http%'
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10
      `, language),
    ]);

    const cells: LanguageMapCell[] = gridRows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      count: r.count,
      topLogin: r.topLogin,
    }));

    const totalMapped = cells.reduce((acc, c) => acc + c.count, 0);

    const topCountries: LanguageTopCountry[] = countryRows.map((r) => ({
      country: r.country,
      count: r.count,
    }));

    return NextResponse.json(
      { language, cells, totalMapped, topCountries } satisfies LanguageMapData,
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    logError(`devs/${slug}`, err);
    return jsonError("internal", 500);
  }
};
