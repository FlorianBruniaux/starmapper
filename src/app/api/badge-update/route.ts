// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";
import { verifyToken, COOKIE_NAME } from "@/lib/api-token";
import { computeOrganicScore } from "@/lib/organic-score";

const ORGANIC_ENABLED = process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED === "true";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, mappedCount, countryCount, totalCount, language, forksCount, watchersCount } = body;

    const key = validateOwnerRepo(owner, repo);
    if (
      !key ||
      typeof mappedCount !== "number" || mappedCount < 0 || mappedCount > 10_000_000 ||
      typeof countryCount !== "number" || countryCount < 0 || countryCount > 10_000 ||
      typeof totalCount !== "number" || totalCount < 0 || totalCount > 10_000_000 ||
      (language !== undefined && language !== null && typeof language !== "string") ||
      (forksCount !== undefined && typeof forksCount !== "number") ||
      (watchersCount !== undefined && typeof watchersCount !== "number")
    ) {
      return jsonError("invalid_params", 400);
    }
    const lang: string | null = typeof language === "string" && language.length > 0 ? language : null;
    const forks: number | null = typeof forksCount === "number" ? forksCount : null;
    const watchers: number | null = typeof watchersCount === "number" ? watchersCount : null;

    // SM token anti-scraping check — skipped when SM_TOKEN_SECRET is not configured
    const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
    if (SM_SECRET) {
      const smToken = req.cookies.get(COOKIE_NAME)?.value;
      if (!await verifyToken(smToken, SM_SECRET)) {
        return jsonError("forbidden", 403);
      }
    }

    // Plausibility check: reject updates that deviate >50% from existing badge data.
    const existing = await prisma.badgeCache.findUnique({ where: { owner_repo: key } });
    if (existing && existing.totalCount > 0) {
      const ratio = totalCount / existing.totalCount;
      if (ratio > 1.5 || ratio < 0.5) {
        return jsonError("invalid_params", 400);
      }
    }

    // Compute organic score when flag is enabled and forks/watchers are provided.
    let organicScore: number | null = null;
    let organicTier: string | null = null;
    let organicComputedAt: Date | null = null;

    if (ORGANIC_ENABLED && forks !== null && watchers !== null && totalCount > 0) {
      const [sample] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
          COUNT(*)::bigint                                  AS sample_size
        FROM github_user gu
        INNER JOIN star_event se ON se.login = gu.login
        WHERE se.owner = ${key.owner}
          AND se.repo  = ${key.repo}
          AND gu."dataVersion" >= 1
      `;
      const result = computeOrganicScore({
        starsCount:        totalCount,
        forksCount:        forks,
        watchersCount:     watchers,
        zeroFollowerCount: sample ? Number(sample.zero_count) : null,
        sampleSize:        sample ? Number(sample.sample_size) : null,
      });
      organicScore       = result.score;
      organicTier        = result.tier;
      organicComputedAt  = new Date();
    }

    await prisma.badgeCache.upsert({
      where:  { owner_repo: key },
      create: {
        ...key,
        mappedCount,
        countryCount,
        totalCount,
        language: lang,
        forksCount: forks,
        watchersCount: watchers,
        organicScore,
        organicTier,
        organicComputedAt,
      },
      update: {
        mappedCount,
        countryCount,
        totalCount,
        language: lang,
        ...(forks !== null && { forksCount: forks }),
        ...(watchers !== null && { watchersCount: watchers }),
        ...(organicComputedAt && { organicScore, organicTier, organicComputedAt }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("internal", 500);
  }
};
