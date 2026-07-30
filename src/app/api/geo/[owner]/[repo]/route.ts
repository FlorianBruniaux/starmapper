// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { gunzipSync } from "zlib";
import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/api-key";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError, getIP } from "@/lib/api-helpers";
import { parseLocation } from "@/lib/location-parser";
import type { StargazerPoint } from "@/app/api/chunk/route";
import { UPSTASH_CLIENT_CONFIG } from "@/lib/upstash-resilience";

// ---------------------------------------------------------------------------
// Rate limiter — 60 req/min per IP (separate from middleware tiers)
// ---------------------------------------------------------------------------

const redis = Redis.fromEnv(UPSTASH_CLIENT_CONFIG);

const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "60 s"),
  prefix: "rl:geo",
});

// Secondary limiter per API key hash — prevents a single stolen key from DoS-ing
// the endpoint from many IPs. 300 req/h is generous for legitimate automation.
const keyLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(300, "60 m"),
  prefix: "rl:geo-key",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decompress gzip+base64 → parsed JSON array.
 * The stargazer_cache stores points as gzip+base64 (compressed client-side
 * via Web CompressionStream). Node's zlib.gunzipSync handles the decompression.
 */
const safeReviver = (key: string, value: unknown) =>
  key === "__proto__" || key === "constructor" || key === "prototype" ? undefined : value;

const decompressPoints = (gz: string): StargazerPoint[] => {
  const json = gunzipSync(Buffer.from(gz, "base64")).toString("utf-8");
  return JSON.parse(json, safeReviver) as StargazerPoint[];
};

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

  // 2. Rate limit by IP — runs BEFORE auth so a brute-forced/invalid API key still counts
  // against the caller's quota. Previously this ran after the key lookup, so unlimited
  // 401s cost nothing: an attacker could probe an unbounded number of keys for free.
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

  // 3. Extract API key from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError("unauthorized", 401);
  }
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return jsonError("unauthorized", 401);

  // 4. Verify key exists and is not revoked — lookup by keyHash (SHA-256) only.
  // Backfill (scripts/backfill-api-key-hash.ts) has been run; plaintext fallback removed.
  const incomingHash = hashApiKey(apiKey);
  let keyRecord: { key: string; revokedAt: Date | null } | null;
  try {
    keyRecord = await prisma.apiKey.findUnique({
      where: { keyHash: incomingHash },
      select: { key: true, revokedAt: true },
    });
  } catch (err) {
    logError("geo/api-key-lookup", err);
    return jsonError("internal_error", 500);
  }

  if (!keyRecord) return jsonError("unauthorized", 401);
  if (keyRecord.revokedAt) return jsonError("forbidden", 403);

  // 4b. Rate limit by API key hash — defense against distributed IP spoofing with one stolen key.
  try {
    const { success } = await keyLimiter.limit(incomingHash);
    if (!success) {
      return NextResponse.json(
        { error: "rate_limit" },
        { status: 429, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  } catch {
    // Redis unavailable — fail open
  }

  // 5. Update lastUsedAt (fire-and-forget — non-critical, must not delay response)
  prisma.apiKey
    .update({ where: { key: keyRecord.key }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  // 6. Read scan cache + badge metadata in parallel
  // Strategy: aggregate from stargazer_cache (single PK lookup + in-memory JS groupBy)
  // rather than a live star_event JOIN github_user query. The JOIN on 11M rows hits
  // Neon's statement_timeout for large repos. The cache is always fresh enough for
  // this use case (aggregates don't need to be real-time).
  let cacheRecord: { points: string; totalCount: number; scannedAt: Date } | null;
  let badge: { totalCount: number; mappedCount: number } | null;

  try {
    [cacheRecord, badge] = await Promise.all([
      prisma.stargazerCache.findUnique({
        where: { owner_repo: { owner, repo } },
        select: { points: true, totalCount: true, scannedAt: true },
      }),
      prisma.badgeCache.findUnique({
        where: { owner_repo: { owner, repo } },
        select: { totalCount: true, mappedCount: true },
      }),
    ]);
  } catch (err) {
    logError("geo/db-read", err);
    return jsonError("internal_error", 500);
  }

  // 7. 404 when not scanned yet
  if (!cacheRecord) {
    return NextResponse.json(
      {
        error: "not_found",
        hint: `Scan this repo first at starmapper.bruniaux.com/${owner}/${repo}`,
      },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // 8. Decompress + aggregate in Node.js — fast (~10ms for 50k points)
  let points: StargazerPoint[];
  try {
    points = decompressPoints(cacheRecord.points);
  } catch (err) {
    logError("geo/decompress", err);
    return jsonError("internal_error", 500);
  }

  const countryMap = new Map<string, number>();
  const cityMap = new Map<string, number>();

  for (const p of points) {
    if (!p.location) continue;
    const { country, city } = parseLocation(p.location);
    if (country) countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
    if (city) cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
  }

  const countries = [...countryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([name, count]) => ({ name, count }));

  const cities = [...cityMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([name, count]) => ({ name, count }));

  // Privacy: only aggregated counts are returned — never individual coordinates or logins.
  // Changing this to include per-user data would require a DPIA update and Privacy Policy revision.
  return NextResponse.json(
    {
      metadata: {
        owner,
        repo,
        totalCount: badge?.totalCount ?? cacheRecord.totalCount,
        geocodedCount: badge?.mappedCount ?? points.length,
        scannedAt: cacheRecord.scannedAt.toISOString(),
        apiVersion: "1",
      },
      countries,
      cities,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
