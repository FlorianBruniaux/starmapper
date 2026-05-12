// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type GeoVelocityItem = {
  country: string;
  stars30d: number;
  stars90d: number;
  total: number;
  trend: "rising" | "new" | "stable" | "declining";
  ratio: number; // 30d daily rate ÷ 60d historical daily rate (capped at 10)
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(owner, repo);

  try {
    const rows = await prisma.$queryRaw<{
      country: string;
      stars_30d: bigint;
      stars_90d: bigint;
      total: bigint;
    }[]>`
      SELECT
        u."countryNormalized"                                                             AS country,
        COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '30 days')              AS stars_30d,
        COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '90 days')              AS stars_90d,
        COUNT(*)                                                                          AS total
      FROM star_event se
      JOIN github_user u USING (login)
      WHERE se.owner  = ${key.owner}
        AND se.repo   = ${key.repo}
        AND u."countryNormalized" IS NOT NULL
        AND se."starredAt"        IS NOT NULL
      GROUP BY u."countryNormalized"
      HAVING COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '90 days') > 0
      ORDER BY stars_30d DESC
      LIMIT 20
    `;

    const items: GeoVelocityItem[] = rows.map((r) => {
      const stars30d = Number(r.stars_30d);
      const stars90d = Number(r.stars_90d);
      const total    = Number(r.total);

      // 30-day daily rate vs 31-90 day window daily rate
      const rate30       = stars30d / 30;
      const historical60 = stars90d - stars30d; // stars in days 31-90
      const rate60       = historical60 / 60;

      let trend: GeoVelocityItem["trend"];
      let ratio: number;

      if (rate60 === 0) {
        trend = stars30d > 0 ? "new" : "stable";
        ratio = stars30d > 0 ? 10 : 1;
      } else {
        ratio = Math.min(Math.round((rate30 / rate60) * 10) / 10, 10);
        if (ratio >= 1.5)  trend = "rising";
        else if (ratio <= 0.5) trend = "declining";
        else trend = "stable";
      }

      return { country: r.country, stars30d, stars90d, total, trend, ratio };
    });

    // Sort: rising + new first (already ordered by stars_30d desc from SQL)
    items.sort((a, b) => {
      const rank = { rising: 0, new: 1, stable: 2, declining: 3 };
      return rank[a.trend] - rank[b.trend] || b.stars30d - a.stars30d;
    });

    return NextResponse.json({ items }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("stats/geo-velocity", err);
    return jsonError("internal", 500);
  }
};
