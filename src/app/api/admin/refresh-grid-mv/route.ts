// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Refreshes all materialized views: github_user_grid_mv, country_stats_mv,
// power_users_mv, company_stats_mv, trending_repos_mv.
// Runs 1x/day via Vercel Cron (see vercel.json). Also callable manually via admin auth.
// CONCURRENTLY = does not block reads during refresh.
// Sequential loop — parallel refresh exhausts Neon's connection pool and causes cascading failures.

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
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[cron/refresh-grid-mv] CRON_SECRET not set — MV refresh will never run (materialized views will go stale)");
    }
    return jsonError("Unauthorized", 401);
  }
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("Unauthorized", 401);
  }

  return runRefresh();
};

const MV_NAMES = [
  "github_user_grid_mv",
  "country_stats_mv",
  "power_users_mv",
  "company_stats_mv",
  "country_language_stats_mv",
  "user_repo_count_mv",
  "trending_repos_mv",
] as const;

const runRefresh = async () => {
  const start = Date.now();
  const results: { mv: string; durationMs: number; error?: string }[] = [];

  for (const mv of MV_NAMES) {
    const t = Date.now();
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
      results.push({ mv, durationMs: Date.now() - t });
    } catch (err) {
      logError(`admin/refresh-grid-mv [${mv}]`, err);
      results.push({ mv, durationMs: Date.now() - t, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, durationMs: Date.now() - start, results });
};
