// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { jsonError, logError } from "@/lib/api-helpers";
import { verifyToken, COOKIE_NAME } from "@/lib/api-token";
import type { NextRequest } from "next/server";

const bodySchema = z.object({
  login: z.string().regex(/^[a-zA-Z0-9_-]{1,39}$/),
  pointsGz: z.string().max(30_000_000),
  unmappedGz: z.string().max(30_000_000),
  totalCount: z.number().int().nonnegative(),
});

export const POST = async (req: NextRequest) => {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return jsonError("invalid_params", 400);
    const { login, pointsGz, unmappedGz, totalCount } = parsed.data;

    const SM_SECRET = process.env.SM_TOKEN_SECRET;
    if (!SM_SECRET) {
      logError("follower-cache POST", new Error("SM_TOKEN_SECRET not configured"));
      return jsonError("forbidden", 403);
    }
    const smToken = req.cookies.get(COOKIE_NAME)?.value;
    if (!(await verifyToken(smToken, SM_SECRET))) {
      return jsonError("forbidden", 403);
    }

    // Plausibility check — totalCount must not vastly exceed the user's known follower count.
    // Prevents cache poisoning by verifying against the ground-truth stored in github_user.
    const knownUser = await prisma.gitHubUser.findUnique({
      where: { login },
      select: { followers: true },
    });
    if (knownUser && knownUser.followers > 0) {
      // Allow up to 110% of known follower count (some followers may not be in DB yet)
      if (totalCount > knownUser.followers * 1.1) {
        return jsonError("totalCount_mismatch", 400);
      }
    }

    const health = await checkDbHealth();
    if (health.ok && health.usagePct >= DB_CRITICAL_PCT) return jsonError("storage_full", 507);

    await prisma.followerCache.upsert({
      where: { login },
      create: { login, pointsGz, unmappedGz, totalCount, scannedAt: new Date() },
      update: { pointsGz, unmappedGz, totalCount, scannedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("follower-cache POST", err);
    return jsonError("internal", 500);
  }
};
