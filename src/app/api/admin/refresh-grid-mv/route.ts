// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Refreshes all materialized views: github_user_grid_mv, country_stats_mv,
// power_users_mv, company_stats_mv, trending_repos_mv.
// Runs 1x/day via Vercel Cron (see vercel.json). Also callable manually via admin auth.
// CONCURRENTLY = does not block reads during refresh.
// Sequential loop — parallel refresh exhausts Neon's connection pool and causes cascading failures.

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    return jsonError("not_found", 404);
  }
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("not_found", 404);
  }

  return runRefresh();
};

// Pre-built static SQL — no string interpolation, eliminates $executeRawUnsafe footgun.
// MV names are identifiers (not values), so they cannot be parameterized; pre-building the
// Prisma.sql tagged templates is the correct way to use $executeRaw safely here.
const MV_REFRESH_SQL: ReadonlyArray<{ name: string; sql: Prisma.Sql }> = [
  { name: "github_user_grid_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv` },
  { name: "country_stats_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY country_stats_mv` },
  { name: "power_users_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY power_users_mv` },
  { name: "company_stats_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY company_stats_mv` },
  { name: "country_language_stats_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY country_language_stats_mv` },
  { name: "user_repo_count_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY user_repo_count_mv` },
  { name: "trending_repos_mv", sql: Prisma.sql`REFRESH MATERIALIZED VIEW CONCURRENTLY trending_repos_mv` },
];

const runRefresh = async () => {
  const start = Date.now();
  const results: { mv: string; durationMs: number; error?: string }[] = [];

  for (const { name, sql } of MV_REFRESH_SQL) {
    const t = Date.now();
    try {
      await prisma.$executeRaw(sql);
      results.push({ mv: name, durationMs: Date.now() - t });
    } catch (err) {
      logError(`admin/refresh-grid-mv [${name}]`, err);
      results.push({ mv: name, durationMs: Date.now() - t, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, durationMs: Date.now() - start, results });
};
