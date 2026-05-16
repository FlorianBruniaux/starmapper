// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { StyleSpecification } from "maplibre-gl";
import type { MapProjection } from "@/lib/theme";

/**
 * In-memory cache so re-inits (theme switch, Nearby↔choropleth) skip the Jawg round-trip.
 * Key: `${url}#${projection}` — different projections get separate cache entries.
 */
const styleCache = new Map<string, string | StyleSpecification>();

// ─── sessionStorage layer ─────────────────────────────────────────────────────
// Persists patched styles across hard refreshes. Falls back silently when
// sessionStorage is unavailable (SSR, private browsing, quota exceeded).

const SESSION_PREFIX = "sm-style:";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Jawg token manager ───────────────────────────────────────────────────────
// Supports two tokens: when the primary account hits its Map Views limit (25k/month),
// fetchAndPatchStyle automatically falls back to the secondary token.
// The active slot is persisted in sessionStorage so the switch survives hard refreshes.

const JAWG_TOKEN_1 = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
const JAWG_TOKEN_2 = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2 ?? "";
const TOKEN_SLOT_KEY = "sm-jawg:token-slot";
const QUOTA_STATUSES = new Set([401, 402, 403, 429]);

let activeSlot: "1" | "2" = (() => {
  if (typeof window !== "undefined" && JAWG_TOKEN_2) {
    try {
      if (sessionStorage.getItem(TOKEN_SLOT_KEY) === "2") return "2";
    } catch { /* private browsing / quota */ }
  }
  return "1";
})();

/** Returns the Jawg access token currently active (primary or fallback). */
export const getActiveJawgToken = (): string =>
  activeSlot === "2" && JAWG_TOKEN_2 ? JAWG_TOKEN_2 : JAWG_TOKEN_1;

const swapAccessToken = (url: string, token: string): string => {
  try {
    const u = new URL(url);
    u.searchParams.set("access-token", token);
    return u.toString();
  } catch {
    return url;
  }
};

const switchToFallback = (): boolean => {
  if (!JAWG_TOKEN_2 || activeSlot === "2") return false;
  activeSlot = "2";
  styleCache.clear(); // discard all token-1 cached entries
  try { sessionStorage.setItem(TOKEN_SLOT_KEY, "2"); } catch {}
  return true;
};

type StoredStyle = { value: StyleSpecification | string; storedAt: number };

const readFromSession = (key: string): StyleSpecification | string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return undefined;
    const { value, storedAt } = JSON.parse(raw) as StoredStyle;
    if (Date.now() - storedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_PREFIX + key);
      return undefined;
    }
    return value;
  } catch { return undefined; }
};

const writeToSession = (key: string, value: StyleSpecification | string): void => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify({ value, storedAt: Date.now() }));
  } catch { /* QuotaExceededError — silently skip */ }
};

// ─── fetchAndPatchStyle ───────────────────────────────────────────────────────

/**
 * Fetch a Jawg style URL and apply StarMapper-specific patches:
 * - Sets `projection` to the requested value (defaults to "mercator" if missing from style)
 * - Replaces Noto Sans → Open Sans (available in Jawg tiles)
 * - Removes water_name / marine layers (noisy on the stargazer map)
 * - Patches attribution links to include utm_source=starmapper
 *
 * Cache strategy: in-memory (module lifetime) → sessionStorage (tab lifetime, 24h TTL)
 * → Jawg network fetch. The patched StyleSpecification is stored at both layers so
 * hard refreshes skip the network round-trip and re-patching.
 *
 * Language localisation is handled automatically by Jawg based on Accept-Language header —
 * no lang= param is needed. The map will render in the visitor's browser language.
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
  // If primary token is exhausted (previous failure or previous session), swap proactively
  // so we don't fire a doomed request before detecting the error.
  const effectiveUrl = activeSlot === "2" && JAWG_TOKEN_2
    ? swapAccessToken(url, JAWG_TOKEN_2)
    : url;

  const cacheKey = `${effectiveUrl}#${projection}`;

  // 1. In-memory hit — cheapest possible path
  const inMemory = styleCache.get(cacheKey);
  if (inMemory !== undefined) return inMemory;

  // 2. sessionStorage hit — avoids network on hard refresh
  const inSession = readFromSession(cacheKey);
  if (inSession !== undefined) {
    styleCache.set(cacheKey, inSession);
    return inSession;
  }

  // 3. Network fetch + patch
  try {
    const res = await fetch(effectiveUrl);
    if (!res.ok) {
      // Quota / auth error on primary token → switch to fallback and retry once
      if (QUOTA_STATUSES.has(res.status) && activeSlot === "1" && switchToFallback()) {
        return fetchAndPatchStyle(swapAccessToken(url, JAWG_TOKEN_2), projection);
      }
      return effectiveUrl;
    }
    const json = await res.json() as StyleSpecification;
    if (!json || typeof json !== "object") return effectiveUrl;
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
    writeToSession(cacheKey, json);
    return json;
  } catch {
    styleCache.set(cacheKey, effectiveUrl);
    return effectiveUrl;
  }
};
