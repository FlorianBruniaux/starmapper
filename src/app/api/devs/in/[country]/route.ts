// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";
import { slugToCountry } from "@/lib/countries";

export type CountryMapCell = {
  lat: number;
  lng: number;
  count: number;
  topLogin: string;
};

export type CountryTopLanguage = {
  lang: string;
  count: number;
};

export type CountryMapData = {
  country: string;
  cells: CountryMapCell[];
  totalMapped: number;
  topLanguages: CountryTopLanguage[];
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ country: string }> },
) => {
  const { country: slug } = await params;
  const country = slugToCountry(slug);

  if (!country || country.length < 2) {
    return jsonError("Unknown country", 404);
  }

  try {
    const [gridRows, langRows] = await Promise.all([
      prisma.$queryRaw<{ lat: number; lng: number; count: number; topLogin: string }[]>`
        SELECT
          ROUND(lat::numeric, 1)::float AS lat,
          ROUND(lng::numeric, 1)::float AS lng,
          COUNT(*)::int AS count,
          (array_agg(login ORDER BY followers DESC))[1] AS "topLogin"
        FROM github_user
        WHERE "countryNormalized" = ${country}
          AND lat IS NOT NULL
          AND lng IS NOT NULL
        GROUP BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
        ORDER BY count DESC
      `,
      prisma.$queryRaw<{ lang: string; count: number }[]>`
        SELECT lang, cnt AS count
        FROM country_language_stats_mv
        WHERE country = ${country}
        ORDER BY cnt DESC
        LIMIT 10
      `.catch(() =>
        prisma.$queryRaw<{ lang: string; count: number }[]>`
          SELECT lang.lang, COUNT(*)::int AS count
          FROM github_user,
            LATERAL unnest(languages) lang(lang)
          WHERE "countryNormalized" = ${country}
            AND languages IS NOT NULL
          GROUP BY 1
          ORDER BY count DESC
          LIMIT 10
        `
      ),
    ]);

    if (gridRows.length === 0) {
      return jsonError("No data for this country", 404);
    }

    const cells: CountryMapCell[] = gridRows.map((r) => ({
      lat: r.lat,
      lng: r.lng,
      count: r.count,
      topLogin: r.topLogin,
    }));

    const totalMapped = cells.reduce((acc, c) => acc + c.count, 0);

    const topLanguages: CountryTopLanguage[] = langRows.map((r) => ({
      lang: r.lang,
      count: r.count,
    }));

    return NextResponse.json(
      { country, cells, totalMapped, topLanguages } satisfies CountryMapData,
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    logError(`devs/in/${slug}`, err);
    return jsonError("internal", 500);
  }
};
