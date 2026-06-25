// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Server-to-server endpoint for writing the stargazer_cache without browser interaction.
// Used by the index-repo.ts script after completing the chunk loop.
// Auth: Authorization: Bearer ${CRON_SECRET} (same pattern as cron routes).
// No sm-token, no freshness timestamp check — this is a trusted internal caller.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { safeEqual } from "@/lib/api-token";
import { jsonError, logError } from "@/lib/api-helpers";
import { OWNER_REPO_RE } from "@/lib/api-validation";
import { MAX_CACHEABLE_STARS } from "@/schemas/stargazer-cache";
import { getRedis } from "@/lib/github-auth";

export const maxDuration = 60;

const ownerRepo = z
  .string()
  .regex(OWNER_REPO_RE)
  .refine((s) => !/^\.+$/.test(s))
  .transform((s) => s.toLowerCase());

const adminCacheSchema = z.object({
  owner:      ownerRepo,
  repo:       ownerRepo,
  totalCount: z.number().int().nonnegative().max(MAX_CACHEABLE_STARS),
  pointsGz:   z.string().max(30_000_000),
  unmappedGz: z.string().max(30_000_000),
});

export const POST = async (req: NextRequest): Promise<NextResponse> => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return jsonError("not_found", 404);

  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("not_found", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_params", 400);
  }

  const parsed = adminCacheSchema.safeParse(body);
  if (!parsed.success) return jsonError("invalid_params", 400);

  const { owner, repo, totalCount, pointsGz, unmappedGz } = parsed.data;

  try {
    await prisma.stargazerCache.upsert({
      where:  { owner_repo: { owner, repo } },
      create: { owner, repo, points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: new Date() },
      update: { points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: new Date() },
    });

    // Invalidate the mcp:points Redis L1 cache — fire-and-forget
    // owner/repo are already lowercase-normalized by the zod schema transform above
    const rKey = `mcp:points:v1:${owner}:${repo}`;
    getRedis()?.del(rKey).catch(() => {});

    console.log(`[admin/stargazer-cache] wrote ${owner}/${repo} — ${totalCount} stars`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("admin/stargazer-cache POST", err);
    return jsonError("internal", 500);
  }
};
