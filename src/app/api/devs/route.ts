// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/api-helpers";
import { LANGUAGE_SLUG_MAP, languageToSlug } from "@/lib/languages";

export type LanguageListItem = {
  slug: string;
  name: string;
  count: number;
};

export type LanguageListData = {
  languages: LanguageListItem[];
};

// Canonical language names indexed by lowercase for fast lookup
const CANONICAL_BY_VALUE = new Set(Object.values(LANGUAGE_SLUG_MAP));

export const GET = async () => {
  try {
    // Single unnest + GROUP BY — one GIN-backed scan, no N+1 queries.
    // Filter against the whitelist server-side to exclude GitHub lang parasites
    // (e.g. "robots.txt", "YAML", one-off typos).
    const rows = await prisma.$queryRaw<{ lang: string; cnt: number }[]>`
      SELECT lang, COUNT(*)::int AS cnt
      FROM github_user, unnest(languages) AS lang
      WHERE languages IS NOT NULL
      GROUP BY lang
      ORDER BY cnt DESC
    `;

    const languages: LanguageListItem[] = rows
      .filter((r) => CANONICAL_BY_VALUE.has(r.lang) && r.cnt > 0)
      .map((r) => ({
        slug: languageToSlug(r.lang),
        name: r.lang,
        count: r.cnt,
      }));

    return NextResponse.json(
      { languages } satisfies LanguageListData,
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    logError("devs/list", err);
    // Graceful degradation: switcher falls back to static disabled state
    return NextResponse.json({ languages: [] } satisfies LanguageListData);
  }
};
