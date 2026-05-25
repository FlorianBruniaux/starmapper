// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse, after } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { fetchStargazersPage, GitHubRateLimitError, GitHubTokenInvalidError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { checkDbHealth, DB_WARN_PCT } from "@/lib/db-health";
import { bulkUpsertUsers, bulkUpsertStarEvents, bulkReadUsers, type UserWritePayload } from "@/lib/user-cache";
import { parseLocation } from "@/lib/location-parser";
import { jsonError, extractGhToken, logError, sanitizeError, getIP } from "@/lib/api-helpers";
import { hashApiKey } from "@/lib/api-key";
import { defineRoute } from "@/lib/define-route";
import { chunkSchema } from "@/schemas/chunk";

export type StargazerPoint = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  avatarUrl: string;
  lat: number;
  lng: number;
  starredAt: string | null;
  linkedinUrl: string | null;
};

export type ChunkResponse = {
  points: StargazerPoint[];
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[];
  nextCursor: string | null;
  totalCount: number;
  latestStarredAt: string | null; // ISO timestamp of most recent star in this chunk
};

const buildUserWritePayload = (
  point: StargazerPoint,
  sg: { followers: number; following: number; publicRepos: number; accountCreatedAt: string | null; linkedinUrl: string | null },
): UserWritePayload => {
  const { country, city } = parseLocation(point.location);
  return {
    login: point.login,
    name: point.name,
    company: point.company,
    location: point.location,
    followers: sg.followers,
    following: sg.following,
    publicRepos: sg.publicRepos,
    accountCreatedAt: sg.accountCreatedAt,
    lat: point.lat,
    lng: point.lng,
    linkedinUrl: sg.linkedinUrl,
    countryNormalized: country,
    cityNormalized: city,
  };
};

// Distributed rate limiter — 30 req/min per IP via Upstash. Fail-open if Redis unavailable.
let _chunkLimiter: Ratelimit | null = null;
let _chunkLimiterReady = false;
const getChunkLimiter = (): Ratelimit | null => {
  if (_chunkLimiterReady) return _chunkLimiter;
  _chunkLimiterReady = true;
  try {
    _chunkLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:chunk",
    });
  } catch {
    _chunkLimiter = null;
  }
  return _chunkLimiter;
};

// Per-PAT rate limiter — 300 req/h per client token. Prevents a single stolen PAT
// from exhausting the GitHub API quota (5000 req/h) via distributed IP spoofing.
// Only applied when the client provides x-gh-token (not the server fallback token).
let _chunkPatLimiter: Ratelimit | null = null;
let _chunkPatLimiterReady = false;
const getChunkPatLimiter = (): Ratelimit | null => {
  if (_chunkPatLimiterReady) return _chunkPatLimiter;
  _chunkPatLimiterReady = true;
  try {
    _chunkPatLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(300, "60 m"),
      prefix: "rl:chunk-pat",
    });
  } catch {
    _chunkPatLimiter = null;
  }
  return _chunkPatLimiter;
};

// In-memory rate limiter — max 3 concurrent geocoding sessions across all users.
// Vercel serverless: each instance has its own counter, so this is a per-instance
// limit. Good enough to prevent a single deploy from hammering Jawg on spikes.
let activeSessions = 0;
const MAX_CONCURRENT = 3;

export const POST = async (req: NextRequest) => {
  const limiter = getChunkLimiter();
  if (limiter) {
    const { success } = await limiter.limit(getIP(req));
    if (!success) return jsonError("Rate limit exceeded. Retry in a few seconds.", 429);
  }

  // Per-PAT rate limit — only when the client provides their own x-gh-token.
  // Prevents exhausting the server GitHub quota (5000 req/h) via distributed IPs with one token.
  const clientPat = req.headers.get("x-gh-token");
  if (clientPat) {
    const patLimiter = getChunkPatLimiter();
    if (patLimiter) {
      const { success } = await patLimiter.limit(hashApiKey(clientPat));
      if (!success) return jsonError("Rate limit exceeded. Retry in a few minutes.", 429);
    }
  }

  if (activeSessions >= MAX_CONCURRENT) {
    return jsonError("Server busy — too many concurrent scans. Retry in a few seconds.", 429);
  }

  activeSessions++;
  try {
    return await defineRoute(chunkSchema, async (_req, body) => {
      const clientToken = extractGhToken(req);
      const page = await fetchStargazersPage(
        body.owner,
        body.repo,
        body.cursor ?? null,
        body.since,
        clientToken,
      );

      // Phase 2: check user cache before geocoding — skip Jawg for known users.
      const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
      const logins = page.stargazers.map((s) => s.login);
      const knownUsers = await bulkReadUsers(logins);

      // Only geocode locations for users not in cache, or whose location changed.
      const locationsToGeocode = page.stargazers
        .filter((sg) => {
          const known = knownUsers.get(sg.login);
          if (!known) return true; // new user — geocode
          const isStale = Date.now() - known.fetchedAt.getTime() > STALE_MS;
          const locationChanged = known.location !== (sg.location ?? null);
          return isStale || locationChanged; // stale OR moved — re-geocode
        })
        .map((s) => s.location ?? "")
        .filter(Boolean);

      const geoMap = await geocodeBatch(locationsToGeocode);

      const points: StargazerPoint[] = [];
      const unmapped: ChunkResponse["unmapped"] = [];

      for (const sg of page.stargazers) {
        const known = knownUsers.get(sg.login);
        const loc = sg.location ?? "";

        // Use cached coords if available and location hasn't changed
        let coords: [number, number] | null = null;
        if (known?.lat !== null && known?.lat !== undefined && known?.lng !== null && known?.lng !== undefined && known.location === loc) {
          coords = [known.lat, known.lng];
        } else if (loc) {
          const geo = geoMap.get(loc) ?? null;
          coords = geo;
        }

        if (coords) {
          // Reduce lat/lng precision to ~1.1 km (2 decimals) in response to prevent individual geolocation
          // Full precision is persisted in DB via fire-and-forget writes below
          points.push({ login: sg.login, name: sg.name, bio: sg.bio, company: sg.company, location: sg.location, followers: sg.followers, avatarUrl: sg.avatarUrl, lat: Math.round(coords[0] * 100) / 100, lng: Math.round(coords[1] * 100) / 100, starredAt: sg.starredAt, linkedinUrl: sg.linkedinUrl });
        } else {
          unmapped.push({ login: sg.login, name: sg.name, followers: sg.followers, starredAt: sg.starredAt });
        }
      }

      // First stargazer has the most recent starredAt (DESC order)
      const latestStarredAt = page.stargazers[0]?.starredAt ?? null;

      // Persist users + star events to DB for cross-repo analytics after the response is sent.
      // `after()` keeps the Lambda alive until the work completes, preventing silent data loss.
      const ownerKey = body.owner;
      const repoKey = body.repo;
      after(async () => {
        try {
          const health = await checkDbHealth();
          const dbWarn = health.ok && health.usagePct >= DB_WARN_PCT;
          if (dbWarn) console.warn(`[chunk] DB storage at ${health.usagePct}%`);

          // Only upsert users that are new, changed, or not yet enriched with v0.3.0 data
          const sgByLogin = new Map(page.stargazers.map((sg) => [sg.login, sg]));
          const pointsToWrite = points.filter((p) => {
            const known = knownUsers.get(p.login);
            if (!known) return true; // new user
            if (known.dataVersion < 1) return true; // pre-v0.3.0 user — force re-write to enrich
            return known.location !== (p.location ?? null) || known.lat !== p.lat || known.lng !== p.lng;
          });
          const usersToWrite: UserWritePayload[] = pointsToWrite
            .map((p) => {
              const sg = sgByLogin.get(p.login);
              return sg ? buildUserWritePayload(p, sg) : null;
            })
            .filter((u): u is UserWritePayload => u !== null);
          if (usersToWrite.length > 0) {
            const writtenLogins = new Set(usersToWrite.map((u) => u.login));
            const newStarEvents = page.stargazers
              .filter((sg) => writtenLogins.has(sg.login))
              .map((sg) => ({ login: sg.login, owner: ownerKey, repo: repoKey, starredAt: sg.starredAt }));
            // Sequential: star_event has a FK on github_user.login — users must exist first.
            await bulkUpsertUsers(usersToWrite, health);
            if (newStarEvents.length > 0) await bulkUpsertStarEvents(newStarEvents, health);
          }
        } catch (err) {
          console.error("[chunk] background write failed:", err);
        }
      });

      return NextResponse.json({
        points,
        unmapped,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        latestStarredAt,
      } satisfies ChunkResponse);
    })(req);
  } catch (err: unknown) {
    if (err instanceof GitHubTokenInvalidError) {
      return NextResponse.json({ error: "github_token_invalid" }, { status: 401 });
    }
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "rate_limited", resetAt: err.resetAt }, { status: 429 });
    }
    logError("chunk", err);
    const msg =
      err instanceof Error && err.message.startsWith("GitHub API error")
        ? sanitizeError(err)
        : "internal";
    return jsonError(msg, 500);
  } finally {
    activeSessions--;
  }
};
