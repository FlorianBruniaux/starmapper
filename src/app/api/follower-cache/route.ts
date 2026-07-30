// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { jsonError, logError } from "@/lib/api-helpers";
import { verifyToken, getSmSecrets, COOKIE_NAME } from "@/lib/api-token";
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

    // Same convention as every sibling write route (stargazer-cache, badge-update,
    // recalculate-location, contributors-badge-update): skip the check when
    // SM_TOKEN_SECRET isn't configured (local dev without env vars), don't deny.
    // This route used to deny outright here, which broke it in local dev while every
    // other route stayed usable — an inconsistency, not a deliberate stricter policy.
    const smSecrets = getSmSecrets();
    if (smSecrets.length > 0) {
      const smToken = req.cookies.get(COOKIE_NAME)?.value;
      if (!(await verifyToken(smToken, smSecrets))) {
        return jsonError("forbidden", 403);
      }
    }

    // Plausibility check — totalCount must not vastly exceed the user's known follower count.
    // Prevents cache poisoning by verifying against the ground-truth stored in github_user.
    const knownUser = await prisma.gitHubUser.findUnique({
      where: { login },
      select: { followers: true },
    });
    if (knownUser && knownUser.followers > 0) {
      // Allow up to 5x known follower count — prevents cache poisoning while tolerating
      // significant organic growth between maintenance runs (stale github_user.followers).
      if (totalCount > knownUser.followers * 5) {
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
