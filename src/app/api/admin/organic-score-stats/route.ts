// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, requireAdminAuth } from "@/lib/api-helpers";

export const GET = async (req: NextRequest) => {
  const authErr = requireAdminAuth(req);
  if (authErr) return authErr;

  try {
    type TierRow = { tier: string; cnt: number; stale_count: number; avg_score: number | null };
    type BucketRow = { bucket: number; cnt: number };

    // Two parallel aggregates replace the full table scan + in-memory loop.
    const [tierRows, bucketRows] = await Promise.all([
      prisma.$queryRaw<TierRow[]>`
        SELECT
          COALESCE("organicTier", 'none')                                        AS tier,
          COUNT(*)::int                                                           AS cnt,
          COUNT(*) FILTER (
            WHERE "organicComputedAt" IS NOT NULL
              AND "organicComputedAt" < NOW() - INTERVAL '30 days'
          )::int                                                                  AS stale_count,
          ROUND(AVG("organicScore"))::int                                         AS avg_score
        FROM badge_cache
        GROUP BY "organicTier"
      `,
      prisma.$queryRaw<BucketRow[]>`
        SELECT
          LEAST(10, FLOOR("organicScore"::numeric / 10))::int AS bucket,
          COUNT(*)::int                                        AS cnt
        FROM badge_cache
        WHERE "organicTier" IS NOT NULL
          AND "organicScore" IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket
      `,
    ]);

    const tierCounts: Record<string, number> = {
      healthy: 0, moderate: 0, suspicious: 0, insufficient: 0, none: 0,
    };
    let totalBadgeCacheRows = 0;
    let staleCount = 0;
    let weightedSum = 0;
    let weightedN = 0;

    for (const row of tierRows) {
      const cnt = Number(row.cnt);
      tierCounts[row.tier] = (tierCounts[row.tier] ?? 0) + cnt;
      totalBadgeCacheRows += cnt;
      staleCount += Number(row.stale_count);
      if (row.avg_score !== null && row.tier !== "none") {
        weightedSum += Number(row.avg_score) * cnt;
        weightedN += cnt;
      }
    }

    const avgScore = weightedN > 0 ? Math.round(weightedSum / weightedN) : null;

    const distribution = Array.from({ length: 11 }, (_, i) => {
      const found = bucketRows.find((r) => Number(r.bucket) === i);
      return {
        range: i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`,
        count: found ? Number(found.cnt) : 0,
      };
    });

    return NextResponse.json({ totalBadgeCacheRows, tierCounts, avgScore, distribution, staleCount });
  } catch (err) {
    console.error("[admin/organic-score-stats]", err);
    return jsonError("internal", 500);
  }
};
