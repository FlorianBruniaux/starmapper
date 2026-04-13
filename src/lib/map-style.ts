// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { StyleSpecification } from "maplibre-gl";
import type { MapProjection } from "@/lib/theme";

/**
 * In-memory cache so re-inits (theme switch, Nearby↔choropleth) skip the Jawg round-trip.
 * Key: `${url}#${projection}` — different projections get separate cache entries.
 */
const styleCache = new Map<string, string | StyleSpecification>();

/**
 * Fetch a Jawg style URL and apply StarMapper-specific patches:
 * - Sets `projection` to the requested value (defaults to "mercator" if missing from style)
 * - Replaces Noto Sans → Open Sans (available in Jawg tiles)
 * - Removes water_name / marine layers (noisy on the stargazer map)
 * - Patches attribution links to include utm_source=starmapper
 *
 * Language localisation is handled automatically by Jawg based on Accept-Language header —
 * no lang= param is needed. The map will render in the visitor's browser language.
 *
 * Note on font and label patches: these are applied in code for fork-friendliness so any
 * self-hosted instance works without a Jawg account style. Jawg's Back Office can configure
 * both (Open Sans font + label density) directly in the style, which avoids patching at
 * runtime — but that style is then tied to a specific Jawg account and not forkable.
 *
 * Falls back to the raw URL string if the fetch fails or returns invalid JSON,
 * so MapLibre can still attempt to load the style on its own.
 *
 * @param url        Jawg style JSON URL (including access-token query param)
 * @param projection Map projection to enforce — "mercator" (default) or "globe"
 */
export const fetchAndPatchStyle = async (
  url: string,
  projection: MapProjection = "mercator",
): Promise<string | StyleSpecification> => {
  const cacheKey = `${url}#${projection}`;
  const cached = styleCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const json = await res.json() as StyleSpecification;
    if (!json || typeof json !== "object") return url;
    json.projection = { type: projection };
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
    // Patch Jawg attribution links to use utm_source=starmapper
    for (const key of Object.keys(json.sources ?? {})) {
      const src = (json.sources as Record<string, { attribution?: string }>)[key];
      if (src?.attribution?.includes("jawg.io")) {
        src.attribution = src.attribution.replace(
          /utm_source=[^&"]+/,
          "utm_source=starmapper",
        );
      }
    }
    styleCache.set(cacheKey, json);
    return json;
  } catch {
    styleCache.set(cacheKey, url);
    return url;
  }
};
