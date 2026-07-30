// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Refreshes the four per-repo materialized views that back GET /api/stats/[owner]/[repo]:
// repo_stats_mv, repo_power_users_mv, repo_location_stats_mv, repo_company_stats_mv.
//
// Deliberately NOT merged into /api/admin/refresh-grid-mv. That route already refreshes
// eight views under the same maxDuration of 300s; adding roughly 306s of work would push it
// past Vercel's hard cutoff and it would lose its own views, not just the new ones.
//
// Split over two crons (see vercel.json) for the same reason. Measured build times on Neon
// prod, cold cache: stats 60s, power 62s, location 40s, company 145s. Pairing the two most
// expensive views together would leave 31% headroom under the 300s cutoff, and the upstream
// diagnostic (research-stats-timeouts.md) measured a factor of 2 to 4 between warm and cold
// Neon cache on exactly this query shape. Pairing them across parts caps the worst part at
// roughly 185s instead of 207s.
//
//   part=1  repo_stats_mv, repo_power_users_mv        approx 122s
//   part=2  repo_location_stats_mv, repo_company_stats_mv   approx 185s
//
// repo_power_users_mv reads power_users_mv, which /api/admin/refresh-grid-mv rebuilds every
// four hours. That route's own maxDuration of 300 guarantees the 00:00 pass is dead by
// 00:05, so the 02:00 slot has almost two hours of margin. This is a hard bound from Vercel,
// not an estimate: pg_stat_statements is not installed on prod, so the real duration of
// refresh-grid-mv cannot be measured.
//
// Uses pg Pool (TCP) rather than the Prisma HTTP adapter so SET statement_timeout = 0 holds
// for the whole session. The Neon HTTP adapter sends each query as an independent request,
// where SET has no effect on what follows. Same reasoning as refresh-grid-mv/route.ts.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { Pool } from "pg";
import { requireAdminAuth, jsonError, logError, sanitizeError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";
import { withVerifyFullSsl } from "@/lib/pg-ssl";

export const maxDuration = 300;

const MV_PARTS = {
  1: ["repo_stats_mv", "repo_power_users_mv"],
  2: ["repo_location_stats_mv", "repo_company_stats_mv"],
} as const satisfies Record<number, readonly string[]>;

type Part = keyof typeof MV_PARTS;

// Anything other than "2" runs part 1. A cron misconfigured into an unknown part should
// still refresh something rather than silently no-op.
const parsePart = (req: NextRequest): Part => (req.nextUrl.searchParams.get("part") === "2" ? 2 : 1);

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  return runRefresh(parsePart(req));
};

// Vercel Cron calls GET with Authorization: Bearer ${CRON_SECRET}.
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[cron/refresh-repo-stats] CRON_SECRET not set, repo stats views will go stale");
    }
    return jsonError("not_found", 404);
  }
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("not_found", 404);
  }

  return runRefresh(parsePart(req));
};

// Postgres rejects REFRESH ... CONCURRENTLY on a view that was never populated
// (pg_class.relispopulated = false), which is not the same thing as a view holding zero
// rows. Every view in prisma/sql/views.sql is created with CREATE MATERIALIZED VIEW ... AS
// SELECT, which populates on creation, so prod never hits this. The guard exists for the
// realistic local case: someone creating the views WITH NO DATA to skip the 306s build,
// then wondering why the cron fails with an opaque SQLSTATE 55000.
const isPopulated = async (client: PoolClient, name: string): Promise<boolean> => {
  const { rows } = await client.query<{ relispopulated: boolean }>(
    "SELECT relispopulated FROM pg_class WHERE relname = $1 AND relkind = 'm'",
    [name],
  );
  return rows[0]?.relispopulated ?? false;
};

// Neon's pooler endpoint runs PgBouncer in transaction mode, where a bare SET does not
// survive to the next statement. A REFRESH that then hits the 10s statement_timeout dies
// with 57014, and since every REFRESH here is caught individually the route would happily
// report ok with four errors nobody reads. scripts/db/refresh-mvs.sh already strips this
// for the manual path (its lines 19-28); doing it here too means the cron does not depend
// on how DATABASE_URL happens to be spelled in the Vercel dashboard.
const toDirectEndpoint = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/-pooler(\.|$)/, "$1");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("connect_timeout");
    return parsed.toString();
  } catch {
    // Not a parseable URL: hand it back untouched and let pg produce the real error.
    return url;
  }
};

const runRefresh = async (part: Part) => {
  const start = Date.now();
  const results: { mv: string; durationMs: number; concurrently: boolean; error?: string }[] = [];
  const skipped: string[] = [];

  // Stop starting new views past this point. Without it a Vercel cutoff at 300s kills the
  // response entirely, so a refresh that ran out of budget looks identical to one that never
  // fired. Same idiom as refresh-trending/route.ts:75.
  const deadline = start + 240_000;

  // TCP mode (pg): persistent session so SET statement_timeout = 0 applies to all queries.
  // SSL gate: Neon (prod) requires SSL with cert validation; local Postgres has no SSL.
  // withVerifyFullSsl makes the effective mode explicit (Neon's DATABASE_URL ships
  // sslmode=require, which pg-connection-string treats as an alias for verify-full and warns
  // about on every connect) — no behavior change, just spelling out what already happens.
  const pool = new Pool({
    connectionString: withVerifyFullSsl(toDirectEndpoint(process.env.DATABASE_URL ?? "")),
    ssl: process.env.NODE_ENV === "production" ? true : undefined,
  });

  // Reported back so step 7 of the rollout can confirm the SET actually stuck rather than
  // being silently dropped by a pooled connection. A value other than "0" means every
  // REFRESH below is racing a 10s timeout.
  let effectiveTimeout: string | null = null;
  let client: PoolClient | null = null;

  try {
    // connect() inside the try: a rejection here (Neon cold start, malformed URL) would
    // otherwise skip the finally, leak the pool, and make Next return a bodiless 500, which
    // is indistinguishable from a cron that never fired.
    const conn = (client = await pool.connect());
    await conn.query("SET statement_timeout = 0");
    const timeoutRes = await conn.query<{ statement_timeout: string }>("SHOW statement_timeout");
    effectiveTimeout = timeoutRes.rows[0]?.statement_timeout ?? null;

    for (const name of MV_PARTS[part]) {
      if (Date.now() > deadline) {
        skipped.push(name);
        continue;
      }
      const t = Date.now();
      let attemptedConcurrently = false;
      try {
        // name comes from the MV_PARTS literal above, never from the request. Interpolation
        // is safe here and matches refresh-grid-mv/route.ts:78.
        attemptedConcurrently = await isPopulated(conn, name);
        await conn.query(
          `REFRESH MATERIALIZED VIEW ${attemptedConcurrently ? "CONCURRENTLY " : ""}${name}`,
        );
        results.push({ mv: name, durationMs: Date.now() - t, concurrently: attemptedConcurrently });
      } catch (err) {
        logError(`admin/refresh-repo-stats [${name}]`, err);
        results.push({
          mv: name,
          durationMs: Date.now() - t,
          concurrently: attemptedConcurrently,
          error: sanitizeError(err),
        });
      }
    }
  } finally {
    client?.release();
    await pool.end();
  }

  // ok reflects what actually happened. Hardcoding true would make a run where all four
  // views failed indistinguishable from a clean one for anything reading this endpoint.
  const ok = results.every((r) => !r.error) && skipped.length === 0;

  // No revalidateTag: nothing caches these views on the Next side. /api/stats serves them
  // through Cache-Control and page.tsx through cacheLife.
  return NextResponse.json(
    { ok, part, durationMs: Date.now() - start, effectiveTimeout, results, skipped },
    { status: ok ? 200 : 500 },
  );
};
