import { NextRequest, NextResponse } from "next/server";
import { fetchStargazersPage } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { checkDbHealth, DB_WARN_PCT } from "@/lib/db-health";
import { bulkUpsertUsers, bulkUpsertStarEvents, bulkReadUsers } from "@/lib/user-cache";

export interface StargazerPoint {
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
}

export interface ChunkResponse {
  points: StargazerPoint[];
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[];
  nextCursor: string | null;
  totalCount: number;
  latestStarredAt: string | null; // ISO timestamp of most recent star in this chunk
}

// In-memory rate limiter — max 3 concurrent geocoding sessions across all users.
// Vercel serverless: each instance has its own counter, so this is a per-instance
// limit. Good enough to prevent a single deploy from hammering Jawg on spikes.
let activeSessions = 0;
const MAX_CONCURRENT = 3;

export async function POST(req: NextRequest) {
  if (activeSessions >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: "Server busy — too many concurrent scans. Retry in a few seconds." },
      { status: 429 }
    );
  }

  activeSessions++;
  try {
    const { owner, repo, cursor, since } = await req.json();
    if (!owner || !repo) return NextResponse.json({ error: "Missing owner/repo" }, { status: 400 });

    const repoNameRe = /^[a-zA-Z0-9._-]{1,100}$/;
    if (!repoNameRe.test(owner) || !repoNameRe.test(repo)) {
      return NextResponse.json({ error: "Invalid owner/repo format" }, { status: 400 });
    }

    const clientToken = req.headers.get("x-gh-token") ?? undefined;
    const page = await fetchStargazersPage(owner, repo, cursor ?? null, since ?? undefined, clientToken);

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
        return isStale && locationChanged; // stale AND moved — re-geocode
      })
      .map((s) => s.location ?? "")
      .filter(Boolean);

    const cacheHits = logins.length - locationsToGeocode.length;
    if (cacheHits > 0) console.log(`[chunk] cache hit: ${cacheHits}/${logins.length}, geocoded: ${locationsToGeocode.length}`);

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
        points.push({ login: sg.login, name: sg.name, bio: sg.bio, company: sg.company, location: sg.location, followers: sg.followers, avatarUrl: sg.avatarUrl, lat: coords[0], lng: coords[1], starredAt: sg.starredAt });
      } else {
        unmapped.push({ login: sg.login, name: sg.name, followers: sg.followers, starredAt: sg.starredAt });
      }
    }

    // First stargazer has the most recent starredAt (DESC order)
    const latestStarredAt = page.stargazers[0]?.starredAt ?? null;

    // Fire-and-forget: persist users + star events to DB for cross-repo analytics.
    // Never awaited — does not affect chunk response time.
    const ownerKey = owner.toLowerCase();
    const repoKey = repo.toLowerCase();
    checkDbHealth().then((health) => {
      const dbWarn = health.ok && health.usagePct >= DB_WARN_PCT;
      if (dbWarn) console.warn(`[chunk] DB storage at ${health.usagePct}%`);

      bulkUpsertUsers(points, health).catch(console.error);
      bulkUpsertStarEvents(
        page.stargazers.map((sg) => ({
          login: sg.login,
          owner: ownerKey,
          repo: repoKey,
          starredAt: sg.starredAt,
        })),
        health,
      ).catch(console.error);
    }).catch(console.error);

    return NextResponse.json({
      points,
      unmapped,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
      latestStarredAt,
    } satisfies ChunkResponse);
  } catch (err: unknown) {
    // Log internally but never expose raw error messages to the client
    console.error("[chunk] Error:", err);
    const msg = err instanceof Error && err.message.startsWith("GitHub API error")
      ? err.message
      : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    activeSessions--;
  }
}
