import { NextRequest, NextResponse } from "next/server";
import { fetchStargazersPage } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";

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

    const clientToken = req.headers.get("x-gh-token") ?? undefined;
    const page = await fetchStargazersPage(owner, repo, cursor ?? null, since ?? undefined, clientToken);

    const locations = page.stargazers
      .map((s) => s.location ?? "")
      .filter(Boolean);

const geoMap = await geocodeBatch(locations);

    const points: StargazerPoint[] = [];
    const unmapped: ChunkResponse["unmapped"] = [];

    for (const sg of page.stargazers) {
      const loc = sg.location ?? "";
      const coords = loc ? geoMap.get(loc) ?? null : null;
      if (coords) {
        points.push({ login: sg.login, name: sg.name, bio: sg.bio, company: sg.company, location: sg.location, followers: sg.followers, avatarUrl: sg.avatarUrl, lat: coords[0], lng: coords[1], starredAt: sg.starredAt });
      } else {
        unmapped.push({ login: sg.login, name: sg.name, followers: sg.followers, starredAt: sg.starredAt });
      }
    }

    // First stargazer has the most recent starredAt (DESC order)
    const latestStarredAt = page.stargazers[0]?.starredAt ?? null;

    return NextResponse.json({
      points,
      unmapped,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
      latestStarredAt,
    } satisfies ChunkResponse);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    activeSessions--;
  }
}
