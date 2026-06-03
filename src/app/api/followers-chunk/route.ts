// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { fetchFollowersPage, GitHubRateLimitError, GitHubTokenInvalidError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";
import { jsonError, extractGhToken, logError, sanitizeError, getIP } from "@/lib/api-helpers";
import { hashApiKey } from "@/lib/api-key";
import { defineRoute } from "@/lib/define-route";
import { followersChunkSchema } from "@/schemas/followers-chunk";

export type FollowerPoint = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  avatarUrl: string;
  lat: number;
  lng: number;
};

export type FollowersChunkResponse = {
  points: FollowerPoint[];
  unmapped: { login: string; name: string | null; followers: number; avatarUrl: string }[];
  nextCursor: string | null;
  totalCount: number;
  quotaRemaining: number | null;
};

// Distributed rate limiter — 30 req/min per IP via Upstash. Fail-open if Redis unavailable.
let _limiter: Ratelimit | null = null;
let _limiterReady = false;
const getLimiter = (): Ratelimit | null => {
  if (_limiterReady) return _limiter;
  _limiterReady = true;
  try {
    _limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:followers-chunk",
    });
  } catch {
    _limiter = null;
  }
  return _limiter;
};

// Per-PAT rate limiter — 300 req/h per client token. Prevents a single stolen PAT
// from exhausting the GitHub API quota (5000 req/h) via distributed IP spoofing.
// Only applied when the client provides x-gh-token (not the server fallback token).
let _patLimiter: Ratelimit | null = null;
let _patLimiterReady = false;
const getPatLimiter = (): Ratelimit | null => {
  if (_patLimiterReady) return _patLimiter;
  _patLimiterReady = true;
  try {
    _patLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(300, "60 m"),
      prefix: "rl:followers-chunk-pat",
    });
  } catch {
    _patLimiter = null;
  }
  return _patLimiter;
};

// In-memory rate limiter — max 3 concurrent geocoding sessions across all users.
// Vercel serverless: each instance has its own counter, so this is a per-instance
// limit. Good enough to prevent a single deploy from hammering Jawg on spikes.
let activeSessions = 0;
const MAX_CONCURRENT = 3;

export const POST = async (req: NextRequest) => {
  const limiter = getLimiter();
  if (limiter) {
    const { success } = await limiter.limit(getIP(req));
    if (!success) return jsonError("Rate limit exceeded. Retry in a few seconds.", 429);
  }

  const clientPat = req.headers.get("x-gh-token");
  if (clientPat) {
    const patLimiter = getPatLimiter();
    if (patLimiter) {
      const { success } = await patLimiter.limit(hashApiKey(clientPat));
      if (!success) return jsonError("Rate limit exceeded. Retry in a few minutes.", 429);
    }
  }

  if (activeSessions >= MAX_CONCURRENT) {
    return jsonError("Server busy. Too many concurrent scans. Retry in a few seconds.", 429);
  }

  activeSessions++;
  try {
    return await defineRoute(followersChunkSchema, async (_req, body) => {
      const clientToken = extractGhToken(req);
      const page = await fetchFollowersPage(body.login, body.cursor ?? null, clientToken);

      const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
      const logins = page.followers.map((f) => f.login);
      const knownUsers = await bulkReadUsers(logins);

      // Only geocode locations for users not in cache, or whose location changed.
      const locationsToGeocode = page.followers
        .filter((f) => {
          const known = knownUsers.get(f.login);
          if (!known) return true; // new user — geocode
          const isStale = Date.now() - known.fetchedAt.getTime() > STALE_MS;
          const locationChanged = known.location !== (f.location ?? null);
          return isStale || locationChanged; // stale OR moved — re-geocode
        })
        .map((f) => f.location ?? "")
        .filter(Boolean);

      const geoMap = await geocodeBatch(locationsToGeocode);

      const points: FollowerPoint[] = [];
      const unmapped: FollowersChunkResponse["unmapped"] = [];

      for (const f of page.followers) {
        const known = knownUsers.get(f.login);
        const loc = f.location ?? "";

        // Use cached coords if available and location hasn't changed
        let coords: [number, number] | null = null;
        if (
          known?.lat !== null && known?.lat !== undefined &&
          known?.lng !== null && known?.lng !== undefined &&
          known.location === loc
        ) {
          coords = [known.lat, known.lng];
        } else if (loc) {
          const geo = geoMap.get(loc) ?? null;
          coords = geo;
        }

        if (coords) {
          // Reduce lat/lng precision to ~1.1 km (2 decimals) in response to prevent individual geolocation
          points.push({
            login: f.login,
            name: f.name,
            bio: f.bio,
            company: f.company,
            location: f.location,
            followers: f.followers,
            avatarUrl: f.avatarUrl,
            lat: Math.round(coords[0] * 100) / 100,
            lng: Math.round(coords[1] * 100) / 100,
          });
        } else {
          unmapped.push({
            login: f.login,
            name: f.name,
            followers: f.followers,
            avatarUrl: f.avatarUrl,
          });
        }
      }

      return NextResponse.json({
        points,
        unmapped,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        quotaRemaining: page.quotaRemaining,
      } satisfies FollowersChunkResponse);
    })(req);
  } catch (err: unknown) {
    if (err instanceof GitHubTokenInvalidError) {
      return NextResponse.json({ error: "github_token_invalid" }, { status: 401 });
    }
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "rate_limited", resetAt: err.resetAt }, { status: 429 });
    }
    logError("followers-chunk", err);
    const msg =
      err instanceof Error && err.message.startsWith("GitHub API error")
        ? sanitizeError(err)
        : "internal";
    return jsonError(msg, 500);
  } finally {
    activeSessions--;
  }
};
