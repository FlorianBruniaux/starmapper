// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  fetchContributorsPage,
  fetchContributorLocations,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";
import { jsonError, extractGhToken, logError, sanitizeError } from "@/lib/api-helpers";
import { hashApiKey } from "@/lib/api-key";
import { defineRoute } from "@/lib/define-route";
import { contributorsChunkSchema } from "@/schemas/contributors-chunk";

export const maxDuration = 60;

export type ContributorPoint = {
  login: string;
  contributions: number;
  location: string | null;
  lat: number;
  lng: number;
};

export type ContributorsChunkResponse = {
  points: ContributorPoint[];
  unmapped: { login: string; contributions: number }[];
  nextPage: number | null;
  totalCount: number;
  computing: boolean;
  quotaRemaining: number | null;
};

// Per-IP rate limiting for this route lives in src/proxy.ts (rl:contributors-chunk,
// POST_ROUTES, 30 req/min) — a second per-IP limiter here would double the Upstash
// command cost for zero benefit.

let _patLimiter: Ratelimit | null = null;
let _patLimiterReady = false;
const getPatLimiter = (): Ratelimit | null => {
  if (_patLimiterReady) return _patLimiter;
  _patLimiterReady = true;
  try {
    _patLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(300, "60 m"),
      prefix: "rl:contributors-chunk-pat",
    });
  } catch {
    _patLimiter = null;
  }
  return _patLimiter;
};

let activeSessions = 0;
const MAX_CONCURRENT = 3;

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const POST = async (req: NextRequest) => {
  if (process.env.NODE_ENV === "production") {
    const clientPat = req.headers.get("x-gh-token");
    if (clientPat) {
      const patLimiter = getPatLimiter();
      if (patLimiter) {
        const { success } = await patLimiter.limit(hashApiKey(clientPat));
        if (!success) return jsonError("Rate limit exceeded. Retry in a few minutes.", 429);
      }
    }
  }

  if (activeSessions >= MAX_CONCURRENT) {
    return jsonError("Server busy. Too many concurrent scans. Retry in a few seconds.", 429);
  }

  activeSessions++;
  try {
    return await defineRoute(contributorsChunkSchema, async (_req, body) => {
      const clientToken = extractGhToken(req);
      const page = await fetchContributorsPage(body.owner, body.repo, body.page, clientToken);

      // GitHub is still computing contributor stats — signal client to retry
      if (page.computing) {
        return NextResponse.json({
          points: [],
          unmapped: [],
          nextPage: null,
          totalCount: 0,
          computing: true,
          quotaRemaining: null,
        } satisfies ContributorsChunkResponse);
      }

      const logins = page.contributors.map((c) => c.login);
      const knownUsers = await bulkReadUsers(logins);

      // Logins whose location we need to fetch from GitHub (not in cache, or stale/moved)
      const loginsNeedingLocation = page.contributors
        .filter((c) => {
          const known = knownUsers.get(c.login);
          if (!known) return true;
          const isStale = Date.now() - known.fetchedAt.getTime() > STALE_MS;
          return isStale || known.lat === null || known.lat === undefined;
        })
        .map((c) => c.login);

      // Batch-fetch locations from GitHub for uncached users
      const locationMap = loginsNeedingLocation.length > 0
        ? await fetchContributorLocations(loginsNeedingLocation, clientToken)
        : new Map<string, string | null>();

      // Collect raw location strings for geocoding (use raw, not lowercased — known-gotchas)
      const locationsToGeocode = page.contributors
        .filter((c) => {
          // Skip if cached with valid coords
          const known = knownUsers.get(c.login);
          if (known?.lat !== null && known?.lat !== undefined && known?.lng !== null && known?.lng !== undefined) {
            return false;
          }
          const loc = locationMap.get(c.login) ?? null;
          return !!loc;
        })
        .map((c) => locationMap.get(c.login) as string);

      const geoMap = locationsToGeocode.length > 0
        ? await geocodeBatch(locationsToGeocode)
        : new Map<string, [number, number] | null>();

      const points: ContributorPoint[] = [];
      const unmapped: ContributorsChunkResponse["unmapped"] = [];

      for (const c of page.contributors) {
        const known = knownUsers.get(c.login);

        // Use cached coords when available and not stale
        let coords: [number, number] | null = null;
        if (
          known?.lat !== null && known?.lat !== undefined &&
          known?.lng !== null && known?.lng !== undefined
        ) {
          coords = [known.lat, known.lng];
        } else {
          const loc = locationMap.get(c.login) ?? null;
          if (loc) coords = geoMap.get(loc) ?? null;
        }

        const rawLocation = locationMap.get(c.login) ?? known?.location ?? null;

        if (coords) {
          points.push({
            login: c.login,
            contributions: c.contributions,
            location: rawLocation,
            lat: Math.round(coords[0] * 100) / 100,
            lng: Math.round(coords[1] * 100) / 100,
          });
        } else {
          unmapped.push({ login: c.login, contributions: c.contributions });
        }
      }

      return NextResponse.json({
        points,
        unmapped,
        nextPage: page.hasMore ? body.page + 1 : null,
        totalCount: points.length + unmapped.length,
        computing: false,
        quotaRemaining: page.quotaRemaining,
      } satisfies ContributorsChunkResponse);
    })(req);
  } catch (err: unknown) {
    if (err instanceof GitHubTokenInvalidError) {
      return NextResponse.json({ error: "github_token_invalid" }, { status: 401 });
    }
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "rate_limited", resetAt: err.resetAt }, { status: 429 });
    }
    logError("contributors-chunk", err);
    const msg =
      err instanceof Error && err.message.startsWith("GitHub API error")
        ? sanitizeError(err)
        : "internal";
    return jsonError(msg, 500);
  } finally {
    activeSessions--;
  }
};
