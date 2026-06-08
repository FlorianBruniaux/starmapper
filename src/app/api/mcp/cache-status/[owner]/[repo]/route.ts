// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/cache-status/[owner]/[repo]
// Lightweight metadata endpoint: cached? when? how many users?
// Does NOT transfer the full stargazer blob. Use /api/stargazer-cache/ for that.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type McpCacheStatusResponse = {
  cached: boolean;
  scannedAt: string | null;
  totalCount: number | null;
  mappedCount: number | null;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const cached = await prisma.stargazerCache.findUnique({
      where: { owner_repo: key },
      select: { scannedAt: true, totalCount: true },
    });

    if (!cached) {
      const badge = await prisma.badgeCache.findUnique({
        where: { owner_repo: key },
        select: { updatedAt: true, totalCount: true, mappedCount: true },
      });
      const body: McpCacheStatusResponse = badge
        ? { cached: false, scannedAt: badge.updatedAt.toISOString(), totalCount: badge.totalCount, mappedCount: badge.mappedCount }
        : { cached: false, scannedAt: null, totalCount: null, mappedCount: null };
      return NextResponse.json(body, {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }

    const badge = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: { mappedCount: true },
    });

    return NextResponse.json({
      cached: true,
      scannedAt: cached.scannedAt.toISOString(),
      totalCount: cached.totalCount,
      mappedCount: badge?.mappedCount ?? null,
    } satisfies McpCacheStatusResponse, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    logError("api/mcp/cache-status GET", err);
    return jsonError("internal", 500);
  }
};
