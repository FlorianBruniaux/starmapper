// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { fetchStargazersPage, GitHubRateLimitError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { checkDbHealth, DB_WARN_PCT } from "@/lib/db-health";
import { bulkUpsertUsers, bulkUpsertStarEvents, bulkReadUsers, type UserWritePayload } from "@/lib/user-cache";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, extractGhToken, logError, sanitizeError } from "@/lib/api-helpers";

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

// In-memory rate limiter — max 3 concurrent geocoding sessions across all users.
// Vercel serverless: each instance has its own counter, so this is a per-instance
// limit. Good enough to prevent a single deploy from hammering Jawg on spikes.
let activeSessions = 0;
const MAX_CONCURRENT = 3;

export const POST = async (req: NextRequest) => {
  if (activeSessions >= MAX_CONCURRENT) {
    return jsonError("Server busy — too many concurrent scans. Retry in a few seconds.", 429);
  }

  activeSessions++;
  try {
    const { owner, repo, cursor, since } = await req.json();
    const key = validateOwnerRepo(owner, repo);
    if (!key) return jsonError("Invalid owner/repo format", 400);

    if (since !== undefined && (typeof since !== "string" || isNaN(new Date(since).getTime()))) {
      return jsonError("Invalid since parameter", 400);
    }

    const clientToken = extractGhToken(req);
    const page = await fetchStargazersPage(key.owner, key.repo, cursor ?? null, since ?? undefined, clientToken);

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

    // Fire-and-forget: persist users + star events to DB for cross-repo analytics.
    // Never awaited — does not affect chunk response time.
    const ownerKey = key.owner;
    const repoKey = key.repo;
    checkDbHealth().then((health) => {
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
          if (!sg) return null;
          return {
            login: p.login,
            name: p.name,
            company: p.company,
            location: p.location,
            followers: sg.followers,
            following: sg.following,
            publicRepos: sg.publicRepos,
            accountCreatedAt: sg.accountCreatedAt,
            lat: p.lat,
            lng: p.lng,
            linkedinUrl: sg.linkedinUrl,
          };
        })
        .filter((u): u is UserWritePayload => u !== null);
      if (usersToWrite.length > 0) {
        const writtenLogins = new Set(usersToWrite.map((u) => u.login));
        const newStarEvents = page.stargazers
          .filter((sg) => writtenLogins.has(sg.login))
          .map((sg) => ({ login: sg.login, owner: ownerKey, repo: repoKey, starredAt: sg.starredAt }));
        Promise.all([
          bulkUpsertUsers(usersToWrite, health),
          newStarEvents.length > 0 ? bulkUpsertStarEvents(newStarEvents, health) : Promise.resolve(true),
        ]).catch(console.error);
      }
    }).catch(console.error);

    return NextResponse.json({
      points,
      unmapped,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
      latestStarredAt,
    } satisfies ChunkResponse);
  } catch (err: unknown) {
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "rate_limited", resetAt: err.resetAt }, { status: 429 });
    }
    logError("chunk", err);
    const msg = err instanceof Error && err.message.startsWith("GitHub API error")
      ? sanitizeError(err)
      : "internal";
    return jsonError(msg, 500);
  } finally {
    activeSessions--;
  }
}
