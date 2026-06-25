// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/points/[owner]/[repo]
// MCP-facing endpoint (moderate-get tier: rate limit only) for stargazer map points.
// Returns a precision-reduced, capped list of geocoded stargazers for rendering
// in the Skybridge MCP app map view — no cookie probe or Referer required.
//
// Differences from GET /api/stargazer-cache:
//   - No auth gate (moderate-get instead of stargazer-cache-get)
//   - Payload stripped to { login, lat, lng } only (no avatarUrl, unmapped, latestStarredAt)
//   - Hard cap at 10k points via stride sampling (protects _meta payload size in MCP)
//   - lat/lng rounded to 2 decimal places (~1.1 km precision)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";
import { getRedis } from "@/lib/github-auth";

const POINTS_CAP = 10_000;

type StoredPoint = {
  login: string;
  lat: number;
  lng: number;
  [key: string]: unknown;
};

export type McpPoint = {
  login: string;
  lat: number;
  lng: number;
};

export type McpPointsResponse = {
  points: McpPoint[];
  totalCount: number;
  scannedAt: string;
};

// Stride sampling preserves geographic distribution better than a head-slice.
const samplePoints = (all: StoredPoint[], cap: number): StoredPoint[] => {
  if (all.length <= cap) return all;
  const step = all.length / cap;
  return Array.from({ length: cap }, (_, i) => all[Math.floor(i * step)]);
};

const REDIS_TTL = 21_600; // 6 h

const mcpRedisKey = (owner: string, repo: string) =>
  `mcp:points:v1:${owner.toLowerCase()}:${repo.toLowerCase()}`;

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  const rKey = mcpRedisKey(owner, repo);

  // L1: Redis cache — skip if Redis is not configured
  try {
    const redis = getRedis();
    if (redis) {
      const hit = await redis.get<string>(rKey);
      if (hit) {
        return new NextResponse(hit, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
            "X-Cache": "HIT",
          },
        });
      }
    }
  } catch {
    // Redis unavailable — fall through to DB
  }

  try {
    const cached = await prisma.stargazerCache.findUnique({
      where: { owner_repo: key },
      select: { points: true, totalCount: true, scannedAt: true },
    });

    if (!cached) {
      // Repo known (badge ran) but stargazer cache was evicted or not yet built
      const badge = await prisma.badgeCache.findUnique({
        where: { owner_repo: key },
        select: { updatedAt: true },
      });
      if (badge) {
        return NextResponse.json({ lastScan: badge.updatedAt.toISOString() }, { status: 206 });
      }
      return jsonError("not_found", 404);
    }

    const raw = decompressGzBase64<StoredPoint>(cached.points);
    const sampled = samplePoints(raw, POINTS_CAP);

    const points: McpPoint[] = sampled.map((p) => ({
      login: p.login,
      // 2 decimal places = ~1.1 km precision, limits individual geolocation
      lat: Math.round(p.lat * 100) / 100,
      lng: Math.round(p.lng * 100) / 100,
    }));

    const response: McpPointsResponse = {
      points,
      totalCount: cached.totalCount,
      scannedAt: cached.scannedAt.toISOString(),
    };

    const payload = JSON.stringify(response);

    // Fire-and-forget write to Redis L1 — never blocks the response
    const redis = getRedis();
    if (redis) {
      redis.setex(rKey, REDIS_TTL, payload).catch(() => {});
    }

    return new NextResponse(payload, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    logError("api/mcp/points GET", err);
    return jsonError("internal", 500);
  }
};
