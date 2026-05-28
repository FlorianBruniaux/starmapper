// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { jsonError, logError } from "@/lib/api-helpers";

export type AutocompleteResult = {
  label: string;
  lat: number;
  lng: number;
};

const JAWG_AUTOCOMPLETE = "https://api.jawg.io/places/v1/autocomplete";
const NOMINATIM_SEARCH  = "https://nominatim.openstreetmap.org/search";

const fetchJawg = async (q: string): Promise<AutocompleteResult[]> => {
  const token = process.env.JAWGMAP_ACCESS_TOKEN;
  if (!token) return [];
  const url = `${JAWG_AUTOCOMPLETE}?text=${encodeURIComponent(q)}&size=5`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "x-api-key": token },
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? [])
    .map((f: { geometry: { coordinates: [number, number] }; properties: { label?: string } }) => ({
      label: f.properties?.label ?? "",
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }))
    .filter((i: AutocompleteResult) => i.label);
};

const fetchNominatim = async (q: string): Promise<AutocompleteResult[]> => {
  const url = `${NOMINATIM_SEARCH}?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=0`;
  const res = await fetch(url, {
    headers: { "User-Agent": "StarMapper/1.0 (https://starmapper.app)" },
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];
  const data: Array<{ display_name: string; lat: string; lon: string }> = await res.json();
  return data.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
};

export const GET = async (req: NextRequest) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().substring(0, 100);
  if (!q || q.length < 2) return jsonError("invalid_query", 400);

  try {
    const results = await fetchJawg(q);
    if (results.length > 0) {
      return NextResponse.json(results, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      });
    }
    // Jawg unavailable or no token — fall back to Nominatim
    const fallback = await fetchNominatim(q);
    return NextResponse.json(fallback, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("explore/autocomplete", err);
    return jsonError("internal", 500);
  }
};
