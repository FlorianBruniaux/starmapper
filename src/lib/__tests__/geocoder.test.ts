// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock Prisma before importing geocoder ────────────────────────────────────
// geocoder.ts accesses prisma at call time (not import time), so mocking the
// module is sufficient. We expose the mock fns via module-level variables so
// individual tests can configure them.

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

// Import AFTER the mock declaration — Vitest hoists vi.mock() calls so this is safe.
import { geocode, geocodeBatch } from "@/lib/geocoder";

// ─── Circuit breaker note ─────────────────────────────────────────────────────
// geocoder.ts has module-level counters (jawgErrorCount, geoapifyErrorCount).
// Triggering errors in one test increments those counters permanently for the
// rest of the file. To stay safe:
//   1. Tests that simulate provider ERRORS appear LAST in their describe block.
//   2. Each error-inducing test uses `.mockResolvedValueOnce()` so only one call
//      is affected — subsequent calls fall back to the beforeEach default.
//   3. vitest.config.ts uses `pool: "forks"` so each TEST FILE gets a fresh
//      Node process, preventing inter-file counter leakage.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const jawgFound = (lat: number, lng: number) => ({
  features: [{ geometry: { coordinates: [lng, lat] } }],
});

const jawgNotFound = () => ({ features: [] });

const geoapifyFound = (lat: number, lng: number) => ({
  features: [{ geometry: { coordinates: [lng, lat] } }],
});

const nominatimFound = (lat: number, lng: number) => [{ lat: String(lat), lon: String(lng) }];

// ─── geocode() ────────────────────────────────────────────────────────────────

describe("geocode()", () => {
  beforeEach(() => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_jawg_token");
    vi.stubEnv("GEOAPIFY_APIKEY", "test_geoapify_key");
    mockFindUnique.mockResolvedValue(null); // default: cache miss
    mockUpsert.mockResolvedValue(undefined);
    // Default fetch: Jawg success — prevents circuit breaker from opening on
    // tests that don't configure fetch explicitly.
    vi.spyOn(global, "fetch").mockResolvedValue(makeJsonResponse(jawgFound(48.8566, 2.3522)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ── Empty / invalid input (no fetch calls expected) ────────────────────────
  // Run these first so the circuit breaker counters stay at 0.

  describe("empty / invalid input", () => {
    it("returns null immediately for empty string", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null immediately for whitespace-only string", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("   ")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for a single character — too short", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("X")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for TLD-like strings (.de)", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode(".de")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for placeholder values like 'remote'", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("remote")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for phone-prefix strings like '+62'", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("+62")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for URL strings", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      expect(await geocode("https://example.com")).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── Cache hit (no fetch calls expected) ───────────────────────────────────

  describe("cache hit", () => {
    it("returns cached coordinates without calling any external API", async () => {
      mockFindUnique.mockResolvedValueOnce({ key: "paris", lat: 48.8566, lng: 2.3522 });
      const fetchSpy = vi.spyOn(global, "fetch");

      const result = await geocode("Paris");

      expect(result).toEqual([48.8566, 2.3522]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for a negative cache entry (lat=null, lng=null)", async () => {
      mockFindUnique.mockResolvedValueOnce({ key: "nowhere", lat: null, lng: null });
      const fetchSpy = vi.spyOn(global, "fetch");

      const result = await geocode("Nowhere");

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("normalizes location to lowercase+trim before cache lookup", async () => {
      mockFindUnique.mockResolvedValueOnce({ key: "paris", lat: 48.8566, lng: 2.3522 });

      await geocode("  PARIS  ");

      expect(mockFindUnique).toHaveBeenCalledWith({ where: { key: "paris" } });
    });
  });

  // ── Jawg success (no errors → circuit breaker stays closed) ──────────────

  describe("Jawg primary provider", () => {
    it("calls Jawg on cache miss and returns coordinates", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeJsonResponse(jawgFound(48.8566, 2.3522)),
      );
      expect(await geocode("Paris")).toEqual([48.8566, 2.3522]);
    });

    it("writes result to cache after Jawg success", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeJsonResponse(jawgFound(48.8566, 2.3522)),
      );

      await geocode("Paris");

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "paris" },
          create: expect.objectContaining({ lat: 48.8566, lng: 2.3522 }),
        }),
      );
    });

    it("includes the Jawg token in the request URL", async () => {
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(makeJsonResponse(jawgFound(48.8566, 2.3522)));

      await geocode("Paris");

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("test_jawg_token");
      expect(calledUrl).toContain("jawg.io");
    });

    it("returns null and writes negative cache when Jawg returns empty features", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse(jawgNotFound()));

      const result = await geocode("Xyzzy");

      expect(result).toBeNull();
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ lat: null, lng: null }),
        }),
      );
    });
  });

  // ── Fallback cascade (each test fires one 429 into Jawg — counter goes up
  //    by 1 per test. We have 2 fallback describe blocks, each with ≤2 tests
  //    that touch Jawg, for a max of ~4 error increments. The circuit opens at
  //    ERROR_THRESHOLD=3 so the 4th call sees it open. That is fine: the tests
  //    that need Jawg to succeed are in the earlier describe blocks above.) ──

  describe("Geoapify fallback", () => {
    it("falls back to Geoapify when Jawg returns a non-ok response", async () => {
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 })) // Jawg error
        .mockResolvedValueOnce(makeJsonResponse(geoapifyFound(48.8566, 2.3522)));

      expect(await geocode("Paris")).toEqual([48.8566, 2.3522]);
    });

    it("writes Geoapify result to cache", async () => {
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValueOnce(makeJsonResponse(geoapifyFound(51.5074, -0.1278)));

      await geocode("London");

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ lat: 51.5074, lng: -0.1278 }),
        }),
      );
    });
  });

  describe("Nominatim final fallback", () => {
    it("falls back to Nominatim when both Jawg and Geoapify fail", async () => {
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 })) // Jawg
        .mockResolvedValueOnce(new Response("", { status: 500 })) // Geoapify
        .mockResolvedValueOnce(makeJsonResponse(nominatimFound(35.6762, 139.6503)));

      expect(await geocode("Tokyo")).toEqual([35.6762, 139.6503]);
    });

    it("stores null in cache when all providers return empty results (negative cache)", async () => {
      vi.spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 429 })) // Jawg error
        .mockResolvedValueOnce(new Response("", { status: 500 })) // Geoapify error
        .mockResolvedValueOnce(makeJsonResponse([]));              // Nominatim: not found

      await geocode("Xyzzy Unknownplace");

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "xyzzy unknownplace" },
          create: expect.objectContaining({ lat: null, lng: null }),
        }),
      );
    });
  });
});

// ─── geocodeBatch() ───────────────────────────────────────────────────────────

describe("geocodeBatch()", () => {
  beforeEach(() => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_jawg_token");
    vi.stubEnv("GEOAPIFY_APIKEY", "test_geoapify_key");
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns an empty Map for an empty input array", async () => {
    const result = await geocodeBatch([]);
    expect(result.size).toBe(0);
  });

  it("returns cached values directly without calling external APIs", async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: "paris", lat: 48.8566, lng: 2.3522 },
      { key: "london", lat: 51.5074, lng: -0.1278 },
    ]);
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await geocodeBatch(["Paris", "London"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
    expect(result.get("London")).toEqual([51.5074, -0.1278]);
  });

  it("deduplicates locations before querying cache", async () => {
    mockFindMany.mockResolvedValueOnce([{ key: "berlin", lat: 52.52, lng: 13.405 }]);

    await geocodeBatch(["Berlin", "Berlin", "berlin", " Berlin "]);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { key: { in: ["berlin"] } },
    });
  });

  it("geocodes cache misses via external API", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse(jawgFound(48.8566, 2.3522)));

    const result = await geocodeBatch(["Paris"]);

    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
  });

  it("filters out locations that fail isGeocodeableLocation (placeholders, TLDs, etc.)", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const fetchSpy = vi.spyOn(global, "fetch");

    await geocodeBatch(["remote", "earth", ".de"]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("combines cache hits and newly geocoded results in the same Map", async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: "paris", lat: 48.8566, lng: 2.3522 }, // cache hit
    ]);
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeJsonResponse(jawgFound(52.52, 13.405)), // Berlin: cache miss → geocoded
    );

    const result = await geocodeBatch(["Paris", "Berlin"]);

    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
    expect(result.get("Berlin")).toEqual([52.52, 13.405]);
  });

  it("handles DB unavailability gracefully — falls through to API calls", async () => {
    // cacheBulkRead catches the DB error and returns [] — batch proceeds via API
    mockFindMany.mockRejectedValueOnce(new Error("DB connection refused"));
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse(jawgFound(48.8566, 2.3522)));

    const result = await geocodeBatch(["Paris"]);

    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
  });
});
