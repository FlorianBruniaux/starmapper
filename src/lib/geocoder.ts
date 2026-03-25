import { prisma } from "@/lib/db";

const JAWG_GEOCODING = "https://api.jawg.io/places/v1/search";
const NOMINATIM_GEOCODING = "https://nominatim.openstreetmap.org/search";

// --- Circuit breaker (in-memory, per Vercel instance) ---
let jawgErrorCount = 0;
let jawgCircuitOpenAt = 0;
const CIRCUIT_RESET_MS = 60 * 60 * 1000; // 1h
const ERROR_THRESHOLD = 3;

const isJawgAvailable = (): boolean => {
  if (jawgErrorCount < ERROR_THRESHOLD) return true;
  if (Date.now() - jawgCircuitOpenAt > CIRCUIT_RESET_MS) {
    jawgErrorCount = 0;
    return true;
  }
  return false;
};

const recordJawgError = () => {
  jawgErrorCount++;
  // Use >= + guard to handle concurrent increments correctly
  if (jawgErrorCount >= ERROR_THRESHOLD && jawgCircuitOpenAt === 0) {
    jawgCircuitOpenAt = Date.now();
    console.warn("[geocoder] Jawg circuit open — falling back to Nominatim");
  }
};

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
const callJawg = async (
  location: string,
  token: string,
): Promise<[number, number] | null | "error"> => {
  try {
    const url = `${JAWG_GEOCODING}?text=${encodeURIComponent(location)}&size=1&access-token=${token}`;
    const res = await fetch(url);
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
    const res = await fetch(url, {
      headers: { "User-Agent": "StarMapper/1.0 (starmapper.bruniaux.com)" },
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

// Internal: call external API (Jawg → Nominatim fallback) + write cache.
// Used by both geocode() and geocodeBatch() to avoid double cache reads.
const _resolveAndCache = async (
  location: string,
  key: string,
): Promise<[number, number] | null> => {
  let coords: [number, number] | null = null;

  if (isJawgAvailable()) {
    const token = process.env.JAWGMAP_ACCESS_TOKEN;
    if (token) {
      const jawgResult = await callJawg(location, token);
      if (jawgResult === "error") {
        recordJawgError();
        // fall through to Nominatim
      } else {
        coords = jawgResult;
        await cacheWrite(key, coords?.[0] ?? null, coords?.[1] ?? null);
        return coords;
      }
    }
  }

  // Nominatim fallback
  coords = await callNominatim(location);
  await cacheWrite(key, coords?.[0] ?? null, coords?.[1] ?? null);
  return coords;
};

// --- Public API ---
export async function geocode(location: string): Promise<[number, number] | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;

  const cached = await cacheRead(key);
  if (cached !== undefined && cached !== null) {
    return cached.lat !== null && cached.lng !== null ? [cached.lat, cached.lng] : null;
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

  const misses = [...new Set(locations.filter((loc) => !cachedKeys.has(loc.trim().toLowerCase())))];

  const missResults: ([number, number] | null)[] = [];
  const useJawg = isJawgAvailable();

  if (useJawg) {
    // Jawg: batch of 5 in parallel — call _resolveAndCache directly (no redundant cache read)
    const CONCURRENCY = 5;
    for (let i = 0; i < misses.length; i += CONCURRENCY) {
      const batch = misses.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((loc) => _resolveAndCache(loc, loc.trim().toLowerCase())),
      );
      missResults.push(...results);
    }
  } else {
    // Nominatim: sequential with 1100ms delay (polite use policy)
    for (let i = 0; i < misses.length; i++) {
      const loc = misses[i];
      const result = await _resolveAndCache(loc, loc.trim().toLowerCase());
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
