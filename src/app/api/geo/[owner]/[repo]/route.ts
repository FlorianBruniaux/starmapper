// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

// ---------------------------------------------------------------------------
// Rate limiter — 60 req/min per IP (separate from middleware tiers)
// ---------------------------------------------------------------------------

const redis = Redis.fromEnv();

const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 s"),
  prefix: "rl:geo",
});

const getIP = (req: NextRequest): string =>
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AggRow = { name: string; count: bigint };

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
): Promise<NextResponse> => {
  const { owner: rawOwner, repo: rawRepo } = await params;

  // 1. Validate path params
  const validated = validateOwnerRepo(rawOwner, rawRepo);
  if (!validated) return jsonError("invalid_params", 400);
  const { owner, repo } = validated;

  // 2. Extract API key from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError("unauthorized", 401);
  }
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return jsonError("unauthorized", 401);

  // 3. Verify key exists and is not revoked
  let keyRecord: { key: string; revokedAt: Date | null } | null;
  try {
    keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      select: { key: true, revokedAt: true },
    });
  } catch (err) {
    logError("geo/api-key-lookup", err);
    return jsonError("internal_error", 500);
  }

  if (!keyRecord) return jsonError("unauthorized", 401);
  if (keyRecord.revokedAt) return jsonError("forbidden", 403);

  // 4. Rate limit by IP
  const ip = getIP(req);
  try {
    const { success, limit, remaining, reset } = await limiter.limit(ip);
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        { error: "rate_limit" },
        {
          status: 429,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
          },
        },
      );
    }
  } catch {
    // Redis unavailable — fail open, never block legitimate API consumers
  }

  // 5. Update lastUsedAt (fire-and-forget — non-critical, must not delay response)
  prisma.apiKey
    .update({ where: { key: apiKey }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  // 6. Aggregate countries and cities via star_event JOIN github_user
  let countries: AggRow[];
  let cities: AggRow[];
  let badge: { totalCount: number; mappedCount: number } | null;
  let scannedAt: Date | null;

  try {
    const [countriesRaw, citiesRaw, badgeRaw, cacheRaw] = await Promise.all([
      prisma.$queryRaw<AggRow[]>`
        SELECT gu."countryNormalized" AS name, COUNT(*) AS count
        FROM star_event se
        JOIN github_user gu ON gu.login = se.login
        WHERE se.owner = ${owner} AND se.repo = ${repo}
          AND gu."countryNormalized" IS NOT NULL
          AND gu."countryNormalized" NOT LIKE 'http%'
        GROUP BY gu."countryNormalized"
        ORDER BY count DESC
        LIMIT 50
      `,
      prisma.$queryRaw<AggRow[]>`
        SELECT gu."cityNormalized" AS name, COUNT(*) AS count
        FROM star_event se
        JOIN github_user gu ON gu.login = se.login
        WHERE se.owner = ${owner} AND se.repo = ${repo}
          AND gu."cityNormalized" IS NOT NULL
          AND gu."cityNormalized" <> ''
        GROUP BY gu."cityNormalized"
        ORDER BY count DESC
        LIMIT 50
      `,
      prisma.badgeCache.findUnique({
        where: { owner_repo: { owner, repo } },
        select: { totalCount: true, mappedCount: true },
      }),
      prisma.stargazerCache.findUnique({
        where: { owner_repo: { owner, repo } },
        select: { scannedAt: true },
      }),
    ]);
    countries = countriesRaw;
    cities = citiesRaw;
    badge = badgeRaw;
    scannedAt = cacheRaw?.scannedAt ?? null;
  } catch (err) {
    logError("geo/query", err);
    return jsonError("internal_error", 500);
  }

  // 7. 404 when no data — repo hasn't been scanned yet
  if (countries.length === 0 && cities.length === 0) {
    return NextResponse.json(
      {
        error: "not_found",
        hint: `Scan this repo first at starmapper.bruniaux.com/${owner}/${repo}`,
      },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const geocodedCount = countries.reduce((sum, r) => sum + Number(r.count), 0);

  return NextResponse.json(
    {
      metadata: {
        owner,
        repo,
        totalCount: badge?.totalCount ?? geocodedCount,
        geocodedCount: badge?.mappedCount ?? geocodedCount,
        scannedAt: scannedAt?.toISOString() ?? null,
        apiVersion: "1",
      },
      countries: countries.map((r) => ({ name: r.name, count: Number(r.count) })),
      cities: cities.map((r) => ({ name: r.name, count: Number(r.count) })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
