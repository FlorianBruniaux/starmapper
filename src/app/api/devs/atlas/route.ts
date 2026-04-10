// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/api-helpers";

export type AtlasCountry = {
  country: string;
  topLang: string;
  topCnt: number;
  total: number;
};

export type AtlasDominantData = {
  mode: "dominant";
  countries: AtlasCountry[];
  meta: {
    minDevsThreshold: number;
    generatedAt: string;
  };
};

const MIN_DEVS_PER_COUNTRY = 10;

const EMPTY: AtlasDominantData = {
  mode: "dominant",
  countries: [],
  meta: { minDevsThreshold: MIN_DEVS_PER_COUNTRY, generatedAt: new Date().toISOString() },
};

export const GET = async () => {
  try {
    // DISTINCT ON (country) with tie-breaker (cnt DESC, lang ASC) for stability
    // across cron refreshes when two langs share the same count in a country.
    // HAVING SUM(cnt) >= MIN guarantees enough data before declaring a "dominant" lang.
    const rows = await prisma.$queryRaw<
      { country: string; top_lang: string; top_cnt: number; total: number }[]
    >`
      WITH totals AS (
        SELECT country, SUM(cnt)::int AS total
        FROM country_language_stats_mv
        GROUP BY country
        HAVING SUM(cnt) >= ${MIN_DEVS_PER_COUNTRY}
      ),
      top_per_country AS (
        SELECT DISTINCT ON (m.country)
          m.country, m.lang AS top_lang, m.cnt AS top_cnt
        FROM country_language_stats_mv m
        INNER JOIN totals t ON t.country = m.country
        ORDER BY m.country, m.cnt DESC, m.lang ASC
      )
      SELECT tpc.country, tpc.top_lang, tpc.top_cnt, tot.total
      FROM top_per_country tpc
      JOIN totals tot ON tot.country = tpc.country
      ORDER BY tot.total DESC
    `;

    const countries: AtlasCountry[] = rows.map((r) => ({
      country: r.country,
      topLang: r.top_lang,
      topCnt: r.top_cnt,
      total: r.total,
    }));

    return NextResponse.json(
      {
        mode: "dominant",
        countries,
        meta: {
          minDevsThreshold: MIN_DEVS_PER_COUNTRY,
          generatedAt: new Date().toISOString(),
        },
      } satisfies AtlasDominantData,
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    logError("devs/atlas", err);
    // Graceful degradation: MV missing or DB down → empty atlas, page shows empty state
    return NextResponse.json(EMPTY);
  }
};
