// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, requireAdminAuth } from "@/lib/api-helpers";

const BUCKET_SIZE = 10;
const BUCKETS = 10; // 0-9, 10-19, ..., 90-99, 100

export const GET = async (req: NextRequest) => {
  const authErr = requireAdminAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await prisma.badgeCache.findMany({
      select: { organicScore: true, organicTier: true, organicComputedAt: true },
    });

    const tierCounts: Record<string, number> = {
      healthy: 0, moderate: 0, suspicious: 0, insufficient: 0, none: 0,
    };
    const distribution: number[] = Array(BUCKETS + 1).fill(0); // 0-9 … 100
    const scores: number[] = [];

    for (const row of rows) {
      if (!row.organicTier) { tierCounts.none++; continue; }
      const tier = row.organicTier as string;
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      if (row.organicScore !== null) {
        scores.push(row.organicScore);
        const bucket = Math.min(BUCKETS, Math.floor(row.organicScore / BUCKET_SIZE));
        distribution[bucket]++;
      }
    }

    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    const now = Date.now();
    const staleCount = rows.filter((r) =>
      r.organicComputedAt && (now - r.organicComputedAt.getTime() > 30 * 24 * 60 * 60 * 1000)
    ).length;

    return NextResponse.json({
      totalBadgeCacheRows: rows.length,
      tierCounts,
      avgScore,
      distribution: distribution.map((count, i) => ({
        range: i === BUCKETS ? "100" : `${i * BUCKET_SIZE}-${i * BUCKET_SIZE + BUCKET_SIZE - 1}`,
        count,
      })),
      staleCount,
    });
  } catch (err) {
    console.error("[admin/organic-score-stats]", err);
    return jsonError("internal", 500);
  }
};
