// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";
import { verifyToken, COOKIE_NAME } from "@/lib/api-token";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, mappedCount, countryCount, totalCount, language } = body;

    const key = validateOwnerRepo(owner, repo);
    if (
      !key ||
      typeof mappedCount !== "number" || mappedCount < 0 || mappedCount > 10_000_000 ||
      typeof countryCount !== "number" || countryCount < 0 || countryCount > 10_000 ||
      typeof totalCount !== "number" || totalCount < 0 || totalCount > 10_000_000 ||
      (language !== undefined && language !== null && typeof language !== "string")
    ) {
      return jsonError("invalid_params", 400);
    }
    const lang: string | null = typeof language === "string" && language.length > 0 ? language : null;

    // SM token anti-scraping check — skipped when SM_TOKEN_SECRET is not configured
    const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
    if (SM_SECRET) {
      const smToken = req.cookies.get(COOKIE_NAME)?.value;
      if (!await verifyToken(smToken, SM_SECRET)) {
        return jsonError("forbidden", 403);
      }
    }

    // Plausibility check: reject updates that deviate >50% from existing badge data.
    // Prevents arbitrary overwrites with fabricated star counts.
    const existing = await prisma.badgeCache.findUnique({ where: { owner_repo: key } });
    if (existing && existing.totalCount > 0) {
      const ratio = totalCount / existing.totalCount;
      if (ratio > 1.5 || ratio < 0.5) {
        return jsonError("invalid_params", 400);
      }
    }

    await prisma.badgeCache.upsert({
      where: { owner_repo: key },
      create: { ...key, mappedCount, countryCount, totalCount, language: lang },
      update: { mappedCount, countryCount, totalCount, language: lang },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("internal", 500);
  }
};
