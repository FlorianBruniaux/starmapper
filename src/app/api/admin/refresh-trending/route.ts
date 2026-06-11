// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Keeps the Trending feed alive independent of organic traffic. Each run picks the
// least-recently-refreshed repos from the watchlist ∪ top-scanned universe, fetches
// their recent stars (no geocoding), upserts star_events, then refreshes
// trending_repos_mv so the new velocity shows up.
//
// Runs every 6h via Vercel Cron (see vercel.json). Also callable manually via admin auth.
// Pairs with refresh-grid-mv: that job refreshes ALL MVs every 4h; this one feeds fresh
// star_events into the trending MV between those runs.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Pool } from "pg";
import { requireAdminAuth, jsonError, logError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { GitHubRateLimitError } from "@/lib/github";
import { selectRefreshTargets, refreshRepoStarEvents, recordRefresh } from "@/lib/trending-refresh";

export const maxDuration = 300;

// Repos refreshed per run. ~50 keeps each run light on GitHub quota; rotation by
// lastRefreshedAt cycles the full candidate set over a handful of runs.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;
  return runRefresh(parseLimit(req));
};

// Vercel Cron calls GET with Authorization: Bearer ${CRON_SECRET}.
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[cron/refresh-trending] CRON_SECRET not set — trending rescan will never run");
    }
    return jsonError("not_found", 404);
  }
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return jsonError("not_found", 404);
  }
  return runRefresh(parseLimit(req));
};

const parseLimit = (req: NextRequest): number => {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
};

const runRefresh = async (limit: number) => {
  const start = Date.now();
  const health = await checkDbHealth();
  if (!health.ok || (health.ok && health.usagePct >= DB_CRITICAL_PCT)) {
    return NextResponse.json(
      { ok: false, skipped: "db_critical", usagePct: health.ok ? health.usagePct : null },
      { status: 503 },
    );
  }

  const targets = await selectRefreshTargets(limit);
  let reposRefreshed = 0;
  let eventsAdded = 0;
  let rateLimited = false;
  let timeBudgetHit = false;

  // Leave headroom under maxDuration (300s) so the MV refresh always runs.
  const deadline = start + 240_000;

  for (const target of targets) {
    if (Date.now() > deadline) {
      timeBudgetHit = true;
      break;
    }
    try {
      const { eventsAdded: added } = await refreshRepoStarEvents(target, health);
      await recordRefresh(target, added);
      reposRefreshed++;
      eventsAdded += added;
    } catch (err) {
      if (err instanceof GitHubRateLimitError) {
        // Quota exhausted — stop, leave the rest for the next run (they keep an old
        // lastRefreshedAt, so rotation picks them up first).
        rateLimited = true;
        break;
      }
      logError(`cron/refresh-trending [${target.owner}/${target.repo}]`, err);
      // Stamp anyway so a permanently-broken repo (404, renamed) does not block rotation.
      await recordRefresh(target, 0).catch(() => {});
    }
  }

  // Refresh the trending MV so the new star_events surface immediately.
  await refreshTrendingMv();
  revalidateTag("trending", "hours");

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - start,
    candidates: targets.length,
    reposRefreshed,
    eventsAdded,
    rateLimited,
    timeBudgetHit,
  });
};

const refreshTrendingMv = async () => {
  // SSL only in production (Neon requires it). Local Postgres has no SSL — same gate as db.ts,
  // otherwise the MV refresh throws "server does not support SSL connections" locally.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("REFRESH MATERIALIZED VIEW CONCURRENTLY trending_repos_mv");
  } catch (err) {
    logError("cron/refresh-trending [REFRESH MV]", err);
  } finally {
    client.release();
    await pool.end();
  }
};
