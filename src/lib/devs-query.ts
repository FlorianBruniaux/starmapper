// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import { LANGUAGE_SLUG_MAP, languageToSlug } from "@/lib/languages";

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

export type LanguageListItem = {
  slug: string;
  name: string;
  count: number;
};

export type LanguageListData = {
  languages: LanguageListItem[];
};

const MIN_DEVS_PER_COUNTRY = 10;
const CANONICAL_BY_VALUE = new Set(Object.values(LANGUAGE_SLUG_MAP));

export const fetchAtlasData = async (): Promise<AtlasDominantData> => {
  "use cache";
  cacheTag("explore-mvs");
  cacheLife({ revalidate: 3600, stale: 86400 });

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

  return {
    mode: "dominant",
    countries: rows.map((r) => ({
      country: r.country,
      topLang: r.top_lang,
      topCnt: r.top_cnt,
      total: r.total,
    })),
    meta: {
      minDevsThreshold: MIN_DEVS_PER_COUNTRY,
      generatedAt: new Date().toISOString(),
    },
  };
};

export const fetchLanguageList = async (): Promise<LanguageListData> => {
  "use cache";
  cacheTag("explore-mvs");
  cacheLife({ revalidate: 3600, stale: 86400 });

  let rows: { lang: string; cnt: number }[];
  try {
    rows = await prisma.$queryRaw<{ lang: string; cnt: number }[]>`
      SELECT lang, SUM(cnt)::int AS cnt
      FROM country_language_stats_mv
      GROUP BY lang
      ORDER BY cnt DESC
    `;
  } catch {
    // MV not yet created — fall back to direct scan (slower but correct)
    rows = await prisma.$queryRaw<{ lang: string; cnt: number }[]>`
      SELECT lang, COUNT(*)::int AS cnt
      FROM github_user, unnest(languages) AS lang
      WHERE languages IS NOT NULL AND lat IS NOT NULL
      GROUP BY lang
      ORDER BY cnt DESC
    `;
  }

  return {
    languages: rows
      .filter((r) => CANONICAL_BY_VALUE.has(r.lang) && r.cnt > 0)
      .map((r) => ({
        slug: languageToSlug(r.lang),
        name: r.lang,
        count: r.cnt,
      })),
  };
};
