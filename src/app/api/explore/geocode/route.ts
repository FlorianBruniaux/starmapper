// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { geocode } from "@/lib/geocoder";
import { jsonError, logError, getIP } from "@/lib/api-helpers";

// Dedicated fail-closed limiter — each call may trigger Jawg or Nominatim,
// so 10 req/min per IP is enforced regardless of the middleware strict-get tier.
let _geocodeLimiter: Ratelimit | null = null;
let _geocodeLimiterReady = false;
const getGeocodeLimiter = (): Ratelimit | null => {
  if (_geocodeLimiterReady) return _geocodeLimiter;
  _geocodeLimiterReady = true;
  try {
    _geocodeLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "rl:explore-geocode",
    });
  } catch {
    _geocodeLimiter = null;
  }
  return _geocodeLimiter;
};

export type GeocodeResponse = {
  lat: number;
  lng: number;
  displayName: string;
};

const JAWG_REVERSE = "https://api.jawg.io/places/v1/reverse";

// Reverse geocode via Jawg — returns a human-readable place name from lat/lng.
const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
  const token = process.env.JAWGMAP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const url = `${JAWG_REVERSE}?lon=${lng}&lat=${lat}`;
    const res = await fetch(url, { next: { revalidate: 0 }, headers: { "x-api-key": token } });
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    return (feature.properties?.label as string | undefined) ?? null;
  } catch {
    return null;
  }
};

export const GET = async (req: NextRequest) => {
  const limiter = getGeocodeLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(getIP(req));
      if (!success) return jsonError("rate_limit", 429);
    } catch {
      // Fail-closed: Redis unavailable → block to protect external geocoding APIs.
      return jsonError("service_unavailable", 503);
    }
  }

  const { searchParams } = new URL(req.url);
  const q   = (searchParams.get("q") ?? "").trim().substring(0, 200);
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");

  // --- Reverse geocode mode (lat + lng provided) ---
  if (isFinite(lat) && isFinite(lng)) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return jsonError("invalid_coords", 400);
    }
    try {
      const displayName = await reverseGeocode(lat, lng);
      return NextResponse.json(
        { lat, lng, displayName: displayName ?? `${lat.toFixed(2)}, ${lng.toFixed(2)}` } satisfies GeocodeResponse,
        { headers: { "Cache-Control": "public, s-maxage=86400" } },
      );
    } catch (err) {
      logError("explore/geocode:reverse", err);
      return jsonError("internal", 500);
    }
  }

  // --- Forward geocode mode (text query) ---
  if (!q || q.length < 2) return jsonError("invalid_query", 400);

  try {
    const coords = await geocode(q);
    if (!coords) return jsonError("not_found", 404);
    return NextResponse.json(
      { lat: coords[0], lng: coords[1], displayName: q } satisfies GeocodeResponse,
      { headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  } catch (err) {
    logError("explore/geocode:forward", err);
    return jsonError("internal", 500);
  }
};