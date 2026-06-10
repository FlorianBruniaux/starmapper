// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Refreshes all materialized views: github_user_grid_mv, country_stats_mv,
// power_users_mv, company_stats_mv, country_language_stats_mv, user_repo_count_mv,
// trending_repos_mv, city_stats_mv.
// Runs 1x/day via Vercel Cron (see vercel.json). Also callable manually via admin auth.
// CONCURRENTLY = does not block reads during refresh.
// Sequential loop — parallel refresh exhausts Neon's connection pool and causes cascading failures.
//
// Uses pg Pool (TCP) instead of Prisma HTTP adapter so that SET statement_timeout = 0
// persists for the full session. Neon HTTP adapter sends each query as an independent
// request — SET has no effect on subsequent queries.
// pg is already a project dependency (DATABASE_DRIVER=standard mode in db.ts).

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Pool } from "pg";
import { requireAdminAuth, jsonError, logError, sanitizeError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";

export const maxDuration = 300;

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

const MV_NAMES = [
  "github_user_grid_mv",
  "country_stats_mv",
  "power_users_mv",
  "company_stats_mv",
  "country_language_stats_mv",
  "user_repo_count_mv",
  "trending_repos_mv",
  "city_stats_mv",
] as const;

const runRefresh = async () => {
  const start = Date.now();
  const results: { mv: string; durationMs: number; error?: string }[] = [];

  // TCP mode (pg): persistent session so SET statement_timeout = 0 applies to all queries.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query("SET statement_timeout = 0");

    for (const name of MV_NAMES) {
      const t = Date.now();
      try {
        await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name}`);
        results.push({ mv: name, durationMs: Date.now() - t });
      } catch (err) {
        logError(`admin/refresh-grid-mv [${name}]`, err);
        results.push({ mv: name, durationMs: Date.now() - t, error: sanitizeError(err) });
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  // Invalidate cached data for pages that read from these MVs
  revalidateTag("trending", "hours");
  revalidateTag("explore-mvs", "hours");

  return NextResponse.json({ ok: true, durationMs: Date.now() - start, results });
};
