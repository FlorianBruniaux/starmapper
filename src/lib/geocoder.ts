import { prisma } from "@/lib/db";

const JAWG_GEOCODING = "https://api.jawg.io/places/v1/search";

async function cacheRead(key: string) {
  try {
    return await prisma.geoCache.findUnique({ where: { key } });
  } catch {
    return undefined; // DB unavailable — skip cache
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
    // ignore — cache write failure is non-fatal
  }
}

async function cacheBulkRead(keys: string[]) {
  try {
    return await prisma.geoCache.findMany({ where: { key: { in: keys } } });
  } catch {
    return []; // DB unavailable — skip cache
  }
}

export async function geocode(location: string): Promise<[number, number] | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;

  const cached = await cacheRead(key);
  if (cached !== undefined && cached !== null) {
    return cached.lat !== null && cached.lng !== null
      ? [cached.lat, cached.lng]
      : null;
  }

  const token = process.env.JAWGMAP_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const url = `${JAWG_GEOCODING}?text=${encodeURIComponent(location)}&size=1&access-token=${token}`;
    const res = await fetch(url);
    if (!res.ok) {
      return null; // don't cache HTTP errors — they may be transient (429, 503)
    }
    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].geometry.coordinates as [number, number];
      await cacheWrite(key, lat, lng);
      return [lat, lng];
    }
    // Cache the "not found" result so we never call Jawg again for this location
    await cacheWrite(key, null, null);
    return null;
  } catch {
    return null;
  }
}

export async function geocodeBatch(locations: string[]): Promise<Map<string, [number, number] | null>> {
  const result = new Map<string, [number, number] | null>();
  const unique = [...new Set(locations.filter(Boolean).map((l) => l.trim().toLowerCase()))];

  const cached = await cacheBulkRead(unique);
  // Track ALL cache hits (including null = "not found") to avoid re-calling Jawg
  const cachedKeys = new Set(cached.map((c) => c.key));
  const cacheMap = new Map(
    cached
      .filter((c) => c.lat !== null && c.lng !== null)
      .map((c) => [c.key, [c.lat, c.lng] as [number, number]])
  );

  const misses = [...new Set(
    locations.filter((loc) => !cachedKeys.has(loc.trim().toLowerCase()))
  )];

  // Limit concurrency to 5 to avoid Jawg rate limiting
  const CONCURRENCY = 5;
  const missResults: ([number, number] | null)[] = [];
  for (let i = 0; i < misses.length; i += CONCURRENCY) {
    const batch = misses.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((loc) => geocode(loc)));
    missResults.push(...results);
  }
  misses.forEach((loc, i) => result.set(loc, missResults[i]));

  for (const loc of locations) {
    const key = loc.trim().toLowerCase();
    if (cacheMap.has(key)) result.set(loc, cacheMap.get(key)!);
  }
  return result;
}
