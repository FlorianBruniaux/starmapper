// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { StyleSpecification } from "maplibre-gl";

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";

/** In-memory cache so re-inits (theme switch, Nearby↔choropleth) skip the Jawg round-trip. */
const styleCache = new Map<string, string | StyleSpecification>();

/**
 * Fetch a Jawg style URL and apply StarMapper-specific patches:
 * - Adds `projection: { type: "mercator" }` if missing (prevents MapLibre crash)
 * - Patches glyph URLs to include the Jawg access token
 * - Replaces Noto Sans → Open Sans (available in Jawg tiles)
 * - Removes water_name / marine layers (noisy on the stargazer map)
 * - Forces English place names
 *
 * Falls back to the raw URL string if the fetch fails or returns invalid JSON,
 * so MapLibre can still attempt to load the style on its own.
 */
export const fetchAndPatchStyle = async (url: string): Promise<string | StyleSpecification> => {
  const cached = styleCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const json = await res.json() as StyleSpecification;
    if (!json || typeof json !== "object") return url;
    if (!json.projection) json.projection = { type: "mercator" };
    if (json.glyphs && JAWG_TOKEN) {
      json.glyphs = json.glyphs.includes("access-token")
        ? json.glyphs
        : `${json.glyphs}${json.glyphs.includes("?") ? "&" : "?"}access-token=${JAWG_TOKEN}`;
    }
    for (const layer of json.layers ?? []) {
      const fonts = (layer as { layout?: { "text-font"?: string[] } }).layout?.["text-font"];
      if (fonts) {
        for (let i = 0; i < fonts.length; i++) {
          if (fonts[i].includes("Noto Sans")) fonts[i] = fonts[i].replace("Noto Sans", "Open Sans");
        }
      }
    }
    json.layers = (json.layers ?? []).filter((layer) => {
      const sl = (layer as { "source-layer"?: string })["source-layer"];
      if (sl === "water_name" || sl === "marine") return false;
      const id = layer.id ?? "";
      if (/^(ocean|marine|water.?name)/i.test(id)) return false;
      return true;
    });
    const fixed = JSON.parse(JSON.stringify(json).replace(/"name:fr"/g, '"name:en"')) as StyleSpecification;
    Object.assign(json, fixed);
    styleCache.set(url, json);
    return json;
  } catch {
    styleCache.set(url, url);
    return url;
  }
};
