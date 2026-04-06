// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/geocoder";
import { jsonError, logError } from "@/lib/api-helpers";

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
    const url = `${JAWG_REVERSE}?lon=${lng}&lat=${lat}&access-token=${token}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    // Build a concise label from the most specific address components
    const p = feature.properties ?? {};
    const parts: string[] = [];
    if (p.name)           parts.push(p.name);
    else if (p.street)    parts.push(p.street);
    if (p.city)           parts.push(p.city);
    else if (p.locality)  parts.push(p.locality);
    if (p.country)        parts.push(p.country);
    return parts.length > 0 ? parts.join(", ") : (feature.properties?.label ?? null);
  } catch {
    return null;
  }
};

export const GET = async (req: NextRequest) => {
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