// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { prisma } from "@/lib/db";
import { CircuitBreaker } from "@/lib/circuit-breaker";

const JAWG_GEOCODING = "https://starmapper.jawg.io/places/v1/search";
const GEOAPIFY_GEOCODING = "https://api.geoapify.com/v1/geocode/search";
const NOMINATIM_GEOCODING = "https://nominatim.openstreetmap.org/search";

// --- Circuit breakers (in-memory, per Vercel instance) ---
const CIRCUIT_RESET_MS = 60 * 60 * 1000; // 1h
const jawgBreaker = new CircuitBreaker(3, CIRCUIT_RESET_MS, "Jawg");
const geoapifyBreaker = new CircuitBreaker(3, CIRCUIT_RESET_MS, "Geoapify");

// --- Cache helpers ---
async function cacheRead(key: string) {
  try {
    return await prisma.geoCache.findUnique({ where: { key } });
  } catch {
    return undefined;
  }
}

async function cacheWrite(key: string, lat: number | null, lng: number | null) {
  try {
    await prisma.geoCache.upsert({
      where: { key },
      update: { lat, lng },
      create: { key, lat, lng },
    });
  } catch {
    // non-fatal
  }
}

async function cacheBulkRead(keys: string[]) {
  try {
    return await prisma.geoCache.findMany({ where: { key: { in: keys } } });
  } catch {
    return [];
  }
}

// --- API callers ---
const fetchWithTimeout = (url: string, ms: number, options?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const callGeoapify = async (
  location: string,
  token: string,
): Promise<[number, number] | null | "error"> => {
  try {
    const url = `${GEOAPIFY_GEOCODING}?text=${encodeURIComponent(location)}&limit=1&apiKey=${token}`;
    const res = await fetchWithTimeout(url, 3000);
    if (!res.ok) return "error"; // 429, 401, 5xx — transient, don't cache
    const data = await res.json();
    const feature = data.features?.[0];
    if (feature) {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      return [lat, lng];
    }
    return null; // valid "not found"
  } catch {
    return "error";
  }
};

const callJawg = async (
  location: string,
  apiKey: string,
): Promise<[number, number] | null | "error"> => {
  try {
    const url = `${JAWG_GEOCODING}?text=${encodeURIComponent(location)}&size=1&access-token=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, 3000, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return "error"; // 429, 402, 5xx — transient, don't cache
    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates as [number, number];
      return [lat, lng];
    }
    return null; // valid "not found"
  } catch {
    return "error";
  }
};

const callNominatim = async (location: string): Promise<[number, number] | null> => {
  try {
    const url = `${NOMINATIM_GEOCODING}?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const res = await fetchWithTimeout(url, 5000, {
      headers: { "User-Agent": `StarMapper/1.0 (${process.env.NEXT_PUBLIC_APP_URL ?? "starmapper.bruniaux.com"})` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    return null;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Geocoding providers (Strategy pattern) ---
// Each provider is an independent object: circuit breaker + availability check + geocode call.
// To add a new provider: create an object and append it to PROVIDERS — no changes to the waterfall.
type GeocodingProvider = {
  name: string;
  breaker?: CircuitBreaker;
  isAvailable: () => boolean;
  geocode: (location: string) => Promise<[number, number] | null | "error">;
};

const jawgProvider: GeocodingProvider = {
  name: "Jawg",
  breaker: jawgBreaker,
  isAvailable: () => jawgBreaker.isAvailable() && !!process.env.JAWG_TOKEN_HEADER,
  geocode: (loc) => callJawg(loc, process.env.JAWG_TOKEN_HEADER!),
};

const geoapifyProvider: GeocodingProvider = {
  name: "Geoapify",
  breaker: geoapifyBreaker,
  isAvailable: () => geoapifyBreaker.isAvailable() && !!process.env.GEOAPIFY_APIKEY,
  geocode: (loc) => callGeoapify(loc, process.env.GEOAPIFY_APIKEY!),
};

const nominatimProvider: GeocodingProvider = {
  name: "Nominatim",
  isAvailable: () => true,
  geocode: callNominatim,
};

const PROVIDERS: readonly GeocodingProvider[] = [jawgProvider, geoapifyProvider, nominatimProvider];

// @-handle strings like "@paris" or "@berlin" — strip @ and geocode the remainder.
// Caches result under the original key (e.g. "@paris" → same coords as "paris").
const _resolveAtHandle = async (
  location: string,
  originalKey: string,
): Promise<[number, number] | null> => {
  const stripped = location.replace(/^@/, "").trim();
  if (!stripped || !isGeocodeableLocation(stripped)) {
    await cacheWrite(originalKey, null, null);
    return null;
  }
  const strippedKey = stripped.toLowerCase();
  const cached = await cacheRead(strippedKey);
  if (cached !== undefined && cached !== null) {
    const coords =
      cached.lat !== null && cached.lng !== null
        ? ([cached.lat, cached.lng] as [number, number])
        : null;
    await cacheWrite(originalKey, coords?.[0] ?? null, coords?.[1] ?? null);
    return coords;
  }
  const result = await _resolveAndCache(stripped, strippedKey);
  await cacheWrite(originalKey, result?.[0] ?? null, result?.[1] ?? null);
  return result;
};

// Multi-location strings like "DEL/BLR/SF" or "NYC / LON" — try each part in order.
// Caches the full original key once a valid result is found.
const _resolveMultiLocation = async (
  location: string,
  originalKey: string,
): Promise<[number, number] | null> => {
  const parts = location
    .split("/")
    .map((s) => s.trim())
    .filter((s) => isGeocodeableLocation(s));

  // Batch-read all parts in one DB round-trip instead of sequential reads per part.
  const partKeys = parts.map((p) => p.toLowerCase());
  const cachedRows = await cacheBulkRead(partKeys);
  const cacheHits = new Map(cachedRows.map((c) => [c.key, c]));

  for (const part of parts) {
    const partKey = part.toLowerCase();
    const hit = cacheHits.get(partKey);
    if (hit !== undefined) {
      if (hit.lat !== null && hit.lng !== null) {
        const coords: [number, number] = [hit.lat, hit.lng];
        await cacheWrite(originalKey, coords[0], coords[1]);
        return coords;
      }
      // cached as null = "not found" → try next part
      continue;
    }
    // Not cached — try geocoding this part
    const result = await _resolveAndCache(part, partKey);
    if (result) {
      await cacheWrite(originalKey, result[0], result[1]);
      return result;
    }
  }

  await cacheWrite(originalKey, null, null);
  return null;
};

// Internal: call external API cascade (Jawg → Geoapify → Nominatim) + write cache.
// Only "error" responses cause fallthrough — null ("not found") is cached and returned immediately.
const _resolveAndCache = async (
  location: string,
  key: string,
): Promise<[number, number] | null> => {
  for (const provider of PROVIDERS) {
    if (!provider.isAvailable()) continue;
    const result = await provider.geocode(location);
    if (result === "error") {
      provider.breaker?.recordError();
      continue; // fall through to next provider
    }
    await cacheWrite(key, result?.[0] ?? null, result?.[1] ?? null);
    return result;
  }
  // All providers unavailable or returned errors — cache null to prevent repeated API calls
  await cacheWrite(key, null, null);
  return null;
};

// Returns false for strings that are clearly not real geographic locations.
// Avoids wasting geocoding quota (and polluting the map) with TLDs, symbols,
// placeholders, or bare phone prefixes that GitHub users put in their location field.
const isGeocodeableLocation = (location: string): boolean => {
  const s = location.trim();
  if (s.length < 2) return false;
  // Must have at least 2 consecutive Latin/Unicode letters
  if (!/[a-zA-ZÀ-ÖØ-öø-ÿ]{2}/.test(s)) return false;
  // Reject TLD-like strings: .de, .hack//metaverse, .local, .nl
  if (s.startsWith(".")) return false;
  // Reject URL-like strings: https://, .hack//metaverse
  if (s.includes("://") || s.includes("//")) return false;
  // Reject filesystem paths: /dev/null, /home/user, /etc/nginx
  if (/^\/[a-zA-Z]/.test(s)) return false;
  // Reject bare phone prefixes: +62, +233 (digits only after +)
  if (/^\+\d[\d\s]*$/.test(s)) return false;
  // Reject hashtags, shell vars, code artifacts: #pnw, $home, <html>, [object Object], {{}}, \f.x
  if (/^[#$<>\[{\\!"]/.test(s)) return false;
  // Reject IP addresses and network strings: 127.0.0.1, 0.0.0.0, 10.0.2.2/24
  if (/^\d{1,3}\.\d{1,3}(\.\d{1,3}){0,2}(\/\d+)?$/.test(s)) return false;
  // Reject pure timezone codes: UTC, GMT+5, CET, IST, PST, etc. (no geographic context)
  if (/^(utc|gmt|cet|cest|eet|eest|ist|est|pst|mst|cst|cdt|edt|pdt|mdt|jst|bst|aest|nzst|wat|cat|eat|wet|art|nst|ast|hst|akst|sgt|hkt|ict|wib|wit|wita)([+-]\d{1,2}(:\d{2})?)?$/i.test(s)) return false;
  // Reject fictional/tech-humor locations that geocode to random real places
  if (/^(the internet|cyberspace|the matrix|matrix|mordor|narnia|hogwarts|middle.?earth|the cloud|digital nomad|planet earth|the void|null island|the moon|mars|universe)$/i.test(s)) return false;
  // Common GitHub placeholder values
  if (/^\(?(null|undefined|none|n\/a|na|tbd|remote|anywhere|earth|world|internet|online|everywhere|localhost)\)?$/i.test(s)) return false;
  return true;
};

// --- Public API ---
export async function geocode(location: string): Promise<[number, number] | null> {
  const key = location.trim().toLowerCase();
  if (!key || !isGeocodeableLocation(key)) return null;

  const cached = await cacheRead(key);
  if (cached !== undefined && cached !== null) {
    return cached.lat !== null && cached.lng !== null ? [cached.lat, cached.lng] : null;
  }

  // @-handle strings like "@paris" — strip @ and geocode remainder
  if (location.trimStart().startsWith("@")) {
    return _resolveAtHandle(location.trimStart(), key);
  }
  // Multi-city strings like "DEL/BLR/SF" — try each part individually
  if (location.includes("/")) {
    return _resolveMultiLocation(location, key);
  }

  return _resolveAndCache(location, key);
}

export async function geocodeBatch(
  locations: string[],
): Promise<Map<string, [number, number] | null>> {
  const result = new Map<string, [number, number] | null>();
  const unique = [...new Set(locations.filter(Boolean).map((l) => l.trim().toLowerCase()))];

  const cached = await cacheBulkRead(unique);
  const cachedKeys = new Set(cached.map((c) => c.key));
  const cacheMap = new Map(
    cached
      .filter((c) => c.lat !== null && c.lng !== null)
      .map((c) => [c.key, [c.lat, c.lng] as [number, number]]),
  );

  const seenKeys = new Set<string>();
  const misses = locations.filter((loc) => {
    const key = loc.trim().toLowerCase();
    if (cachedKeys.has(key) || seenKeys.has(key) || !isGeocodeableLocation(loc)) return false;
    seenKeys.add(key);
    return true;
  });

  const missResults: ([number, number] | null)[] = [];
  const useParallel = jawgProvider.isAvailable() || geoapifyProvider.isAvailable();

  const resolveLocation = (loc: string): Promise<[number, number] | null> => {
    const key = loc.trim().toLowerCase();
    if (loc.trimStart().startsWith("@")) return _resolveAtHandle(loc.trimStart(), key);
    if (loc.includes("/")) return _resolveMultiLocation(loc, key);
    return _resolveAndCache(loc, key);
  };

  if (useParallel) {
    // Jawg or Geoapify available: batch of 5 in parallel (no Nominatim rate limit concern)
    const CONCURRENCY = 5;
    for (let i = 0; i < misses.length; i += CONCURRENCY) {
      const batch = misses.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(resolveLocation));
      missResults.push(...results);
    }
  } else {
    // Both Jawg and Geoapify down: sequential Nominatim with 1100ms delay (polite use policy)
    for (let i = 0; i < misses.length; i++) {
      const result = await resolveLocation(misses[i]);
      missResults.push(result);
      if (i < misses.length - 1) await sleep(1100);
    }
  }

  misses.forEach((loc, i) => result.set(loc, missResults[i]));

  for (const loc of locations) {
    const key = loc.trim().toLowerCase();
    if (cacheMap.has(key)) result.set(loc, cacheMap.get(key)!);
  }
  return result;
}
