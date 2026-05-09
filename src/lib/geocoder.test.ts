// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocode, geocodeBatch } from "@/lib/geocoder";

// --- Mock Prisma ---
// GeoCache state is tracked in-memory so individual tests can control hits/misses.
const geoCacheStore = new Map<string, { key: string; lat: number | null; lng: number | null }>();

vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      findUnique: vi.fn(({ where: { key } }: { where: { key: string } }) =>
        Promise.resolve(geoCacheStore.get(key) ?? null),
      ),
      upsert: vi.fn(
        ({
          where: { key },
          create,
        }: {
          where: { key: string };
          create: { key: string; lat: number | null; lng: number | null };
        }) => {
          geoCacheStore.set(key, create);
          return Promise.resolve(create);
        },
      ),
      findMany: vi.fn(({ where: { key: { in: keys } } }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(
          (keys as string[])
            .map((k: string) => geoCacheStore.get(k))
            .filter(Boolean),
        ),
      ),
    },
  },
}));

// --- Mock global fetch (Nominatim / Jawg / Geoapify) ---
// Default: all providers return a valid Paris coordinate.
const mockFetch = vi.fn();

beforeEach(() => {
  geoCacheStore.clear();
  mockFetch.mockReset();

  // Default fetch: simulate Nominatim returning Paris
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [{ lat: "48.8566", lon: "2.3522" }],
  } as unknown as Response);

  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// geocode() — single location
// ─────────────────────────────────────────────────────────────────────────────

describe("geocode()", () => {
  it("returns null for empty string without calling any API", async () => {
    const result = await geocode("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for whitespace-only string", async () => {
    const result = await geocode("   ");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns cached coordinates on cache hit without calling any provider", async () => {
    geoCacheStore.set("paris", { key: "paris", lat: 48.8566, lng: 2.3522 });

    const result = await geocode("Paris");
    expect(result).toEqual([48.8566, 2.3522]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when cache stores a null entry (known ungeocodeable location)", async () => {
    geoCacheStore.set("localhost", { key: "localhost", lat: null, lng: null });

    // "localhost" also matches the placeholder filter, so test with a real-looking name
    geoCacheStore.set("nowhere ville", { key: "nowhere ville", lat: null, lng: null });
    const result = await geocode("Nowhere Ville");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls the provider cascade on cache miss and returns coordinates", async () => {
    // No cache entry for "Tokyo" — fetch should be called
    const result = await geocode("Tokyo");
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("writes the resolved coordinates to the cache after a successful API call", async () => {
    await geocode("Berlin");
    expect(geoCacheStore.has("berlin")).toBe(true);
    const stored = geoCacheStore.get("berlin");
    expect(stored?.lat).not.toBeNull();
    expect(stored?.lng).not.toBeNull();
  });

  it("writes null to the cache when all providers return nothing (prevents repeated API calls)", async () => {
    // Nominatim returns empty array
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const result = await geocode("Bielefeld Maybe");
    expect(result).toBeNull();
    // Cache should hold null entry
    expect(geoCacheStore.has("bielefeld maybe")).toBe(true);
    const stored = geoCacheStore.get("bielefeld maybe");
    expect(stored?.lat).toBeNull();
  });

  it("returns null and does not call fetch for known placeholder values", async () => {
    const placeholders = ["localhost", "remote", "earth", "the internet", "null island"];
    for (const loc of placeholders) {
      mockFetch.mockClear();
      const result = await geocode(loc);
      expect(result, `expected null for placeholder '${loc}'`).toBeNull();
      expect(mockFetch, `expected no fetch for placeholder '${loc}'`).not.toHaveBeenCalled();
    }
  });

  it("returns null and does not call fetch for IP addresses", async () => {
    const result = await geocode("192.168.1.1");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null and does not call fetch for timezone codes", async () => {
    const result = await geocode("UTC+5");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null and does not call fetch for URL-like strings", async () => {
    const result = await geocode("https://github.com");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles @-handle strings by stripping the @ prefix before geocoding", async () => {
    // Cache "paris" so we can confirm the stripped key is used
    geoCacheStore.set("paris", { key: "paris", lat: 48.8566, lng: 2.3522 });

    const result = await geocode("@paris");
    expect(result).toEqual([48.8566, 2.3522]);
  });

  it("handles slash-separated multi-location strings, attempting each part in order", async () => {
    // All parts miss cache, so Nominatim is called — it returns Paris coords for the first hit
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "28.6139", lon: "77.209" }],
    } as unknown as Response);

    const result = await geocode("DEL/BLR/SF");
    // Should resolve to a valid coordinate (first part that geocodes)
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });

  it("gracefully handles DB error by falling through to live API (no crash)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.geoCache.findUnique).mockRejectedValueOnce(new Error("DB timeout"));

    // Should not throw — falls through to fetch
    const result = await geocode("Munich");
    expect(result).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// geocodeBatch() — multiple locations
// ─────────────────────────────────────────────────────────────────────────────

describe("geocodeBatch()", () => {
  it("returns an empty Map for an empty input array", async () => {
    const result = await geocodeBatch([]);
    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves cache hits without calling any provider", async () => {
    geoCacheStore.set("london", { key: "london", lat: 51.5074, lng: -0.1278 });
    geoCacheStore.set("paris", { key: "paris", lat: 48.8566, lng: 2.3522 });

    const result = await geocodeBatch(["London", "Paris"]);
    expect(result.get("London")).toEqual([51.5074, -0.1278]);
    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deduplicates identical locations before calling the API", async () => {
    // 3 identical strings → should only hit the API once
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "35.6762", lon: "139.6503" }],
    } as unknown as Response);

    await geocodeBatch(["Tokyo", "Tokyo", "tokyo"]);
    // fetchWithTimeout calls fetch, should be at most once for the unique location
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("filters out non-geocodeable strings from the batch", async () => {
    const result = await geocodeBatch(["", "localhost", "192.168.0.1", "Paris"]);
    // Only "Paris" is geocodeable — filtered strings should not appear in result
    expect(result.has("")).toBe(false);
    expect(result.has("localhost")).toBe(false);
  });

  it("returns null for a location when all providers fail", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const result = await geocodeBatch(["Atlantis Fictional City"]);
    expect(result.get("Atlantis Fictional City")).toBeNull();
  });
});
