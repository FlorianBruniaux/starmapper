// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { verifyToken, getSmSecrets, COOKIE_NAME } from "@/lib/api-token";
import { computeOrganicScore } from "@/lib/organic-score";
import { defineRoute } from "@/lib/define-route";
import { badgeUpdateSchema } from "@/schemas/badge-update";

const ORGANIC_ENABLED = process.env.ORGANIC_SCORE_ENABLED === "true";

export const POST = defineRoute(badgeUpdateSchema, async (req: NextRequest, body) => {
  // SM token anti-scraping check — runs after body validation, skipped when SM_TOKEN_SECRET is not configured
  const smSecrets = getSmSecrets();
  if (smSecrets.length > 0) {
    const smToken = req.cookies.get(COOKIE_NAME)?.value;
    if (!(await verifyToken(smToken, smSecrets))) {
      return jsonError("forbidden", 403);
    }
  }

  const lang: string | null =
    typeof body.language === "string" && body.language.length > 0 ? body.language : null;
  const forks: number | null = typeof body.forksCount === "number" ? body.forksCount : null;
  const watchers: number | null = typeof body.watchersCount === "number" ? body.watchersCount : null;

  try {
    const key = { owner: body.owner, repo: body.repo };

    // Plausibility check + organic query run in parallel — both are independent reads.
    // On the rare plausibility failure path, the organic query is discarded harmlessly.
    const shouldComputeOrganic = ORGANIC_ENABLED && forks !== null && watchers !== null && body.totalCount > 0;

    const [existing, sample] = await Promise.all([
      prisma.badgeCache.findUnique({ where: { owner_repo: key }, select: { totalCount: true, releasesCount: true, contributorsCount: true } }),
      shouldComputeOrganic
        ? prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
            SELECT
              COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
              COUNT(*)::bigint                                  AS sample_size
            FROM github_user gu
            INNER JOIN star_event se ON se.login = gu.login
            WHERE se.owner = ${key.owner}
              AND se.repo  = ${key.repo}
              AND gu."dataVersion" >= 1
          `.then((rows) => rows[0])
        : Promise.resolve(undefined),
    ]);

    if (existing && existing.totalCount > 0) {
      const ratio = body.totalCount / existing.totalCount;
      if (ratio > 1.5 || ratio < 0.5) {
        return jsonError("invalid_params", 400);
      }
    }

    // Compute organic score when flag is enabled and forks/watchers are provided.
    let organicScore: number | null = null;
    let organicTier: string | null = null;
    let organicComputedAt: Date | null = null;

    if (shouldComputeOrganic && forks !== null && watchers !== null) {
      const result = computeOrganicScore({
        starsCount: body.totalCount,
        forksCount: forks,
        watchersCount: watchers,
        zeroFollowerCount: sample ? Number(sample.zero_count) : null,
        sampleSize: sample ? Number(sample.sample_size) : null,
        releasesCount: existing?.releasesCount ?? null,
        contributorsCount: existing?.contributorsCount ?? null,
      });
      organicScore = result.score;
      organicTier = result.tier;
      organicComputedAt = new Date();
    }

    await prisma.badgeCache.upsert({
      where: { owner_repo: key },
      create: {
        ...key,
        mappedCount: body.mappedCount,
        countryCount: body.countryCount,
        totalCount: body.totalCount,
        language: lang,
        forksCount: forks,
        watchersCount: watchers,
        organicScore,
        organicTier,
        organicComputedAt,
      },
      update: {
        mappedCount: body.mappedCount,
        countryCount: body.countryCount,
        totalCount: body.totalCount,
        language: lang,
        ...(forks !== null && { forksCount: forks }),
        ...(watchers !== null && { watchersCount: watchers }),
        ...(organicComputedAt && { organicScore, organicTier, organicComputedAt }),
      },
    });

    // Invalidate cached data for this repo immediately after scan completion
    revalidateTag(`badge-${key.owner}-${key.repo}`, "hours");
    revalidateTag(`repo-info-${key.owner}-${key.repo}`, { expire: 300 });
    revalidateTag("repos", { expire: 300 }); // landing page + /repos list

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("internal", 500);
  }
});
