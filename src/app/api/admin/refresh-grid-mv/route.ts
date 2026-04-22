// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Refreshes all materialized views: github_user_grid_mv, country_stats_mv,
// power_users_mv, company_stats_mv, trending_repos_mv.
// Runs 1x/day via Vercel Cron (see vercel.json). Also callable manually via admin auth.
// CONCURRENTLY = does not block reads during refresh.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError, logError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  return runRefresh();
};

// Vercel Cron calls GET with Authorization: Bearer ${CRON_SECRET}.
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || !safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("Unauthorized", 401);
  }

  return runRefresh();
};

const runRefresh = async () => {
  const start = Date.now();
  try {
    await Promise.all([
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY country_stats_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY power_users_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY company_stats_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY country_language_stats_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY user_repo_count_mv`,
      prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY trending_repos_mv`,
    ]);
    return NextResponse.json({ ok: true, durationMs: Date.now() - start });
  } catch (err) {
    logError("admin/refresh-grid-mv", err);
    return jsonError("internal", 500);
  }
};
