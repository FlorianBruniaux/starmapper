// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { jsonError, logError, getIP } from "@/lib/api-helpers";
import { verifyToken, getSmSecrets, COOKIE_NAME } from "@/lib/api-token";
import { hashIp } from "@/lib/ip-hash";
import { getTallies, OPTIONS } from "@/lib/roadmap-vote";
import type { NextRequest } from "next/server";

const bodySchema = z.object({
  options: z
    .array(z.enum(["A", "B", "C", "D"]))
    .min(1)
    .max(4)
    .refine((arr) => new Set(arr).size === arr.length, "duplicate_options"),
});

export const POST = async (req: NextRequest) => {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return jsonError("invalid_params", 400);
    const { options } = parsed.data;

    // Same skip-if-unset convention as every sibling write route (follower-cache,
    // stargazer-cache, badge-update, recalculate-location, contributors-badge-update).
    const smSecrets = getSmSecrets();
    if (smSecrets.length > 0) {
      const smToken = req.cookies.get(COOKIE_NAME)?.value;
      if (!(await verifyToken(smToken, smSecrets))) {
        return jsonError("forbidden", 403);
      }
    }

    const health = await checkDbHealth();
    if (health.ok && health.usagePct >= DB_CRITICAL_PCT) return jsonError("storage_full", 507);

    const ipHash = hashIp(getIP(req));
    await prisma.roadmapVote.upsert({
      where: { ipHash },
      create: { ipHash, options },
      update: { options },
    });

    const { tallies, totalVoters } = await getTallies();
    return NextResponse.json({ ok: true, tallies, totalVoters });
  } catch (err) {
    logError("roadmap-vote POST", err);
    return jsonError("internal", 500);
  }
};

export const GET = async () => {
  try {
    const { tallies, totalVoters } = await getTallies();
    return NextResponse.json(
      { tallies, totalVoters },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
    );
  } catch (err) {
    logError("roadmap-vote GET", err);
    return jsonError("internal", 500);
  }
};

export type RoadmapVoteResponse = { tallies: Record<(typeof OPTIONS)[number], number>; totalVoters: number };
