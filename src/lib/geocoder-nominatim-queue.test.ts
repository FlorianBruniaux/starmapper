// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @vercel/functions so the in-memory fallback cache does not persist between
// tests and pollute geocodeBatch results (test isolation requires a fresh cache per test).
vi.mock("@vercel/functions", () => ({
  getCache: () => ({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    expireTag: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const nominatimFound = (lat: number, lng: number) => [{ lat: String(lat), lon: String(lng) }];

const makeJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Nominatim fallback queue", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubEnv("JAWG_TOKEN_HEADER", "test_jawg_token");
    vi.stubEnv("GEOAPIFY_APIKEY", "test_geoapify_key");
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("falls back through Jawg and Geoapify before using Nominatim", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(makeJsonResponse(nominatimFound(48.8566, 2.3522)));

    const { geocode } = await import("@/lib/geocoder");

    await expect(geocode("Paris")).resolves.toEqual([48.8566, 2.3522]);

    expect(fetchSpy.mock.calls[0][0]).toContain("starmapper.jawg.io");
    expect(fetchSpy.mock.calls[1][0]).toContain("api.geoapify.com");
    expect(fetchSpy.mock.calls[2][0]).toContain("nominatim.openstreetmap.org");
  });

  it("does not call Nominatim for cache hits", async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: "paris", lat: 48.8566, lng: 2.3522 },
      { key: "london", lat: 51.5074, lng: -0.1278 },
    ]);
    const fetchSpy = vi.spyOn(global, "fetch");
    const { geocodeBatch } = await import("@/lib/geocoder");

    const result = await geocodeBatch(["Paris", "London"]);

    expect(result.get("Paris")).toEqual([48.8566, 2.3522]);
    expect(result.get("London")).toEqual([51.5074, -0.1278]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serializes Nominatim fallback calls even when the batch starts in parallel", async () => {
    const nominatimStartedAt: number[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("starmapper.jawg.io")) return new Response("", { status: 429 });
      if (href.includes("api.geoapify.com")) return new Response("", { status: 500 });
      if (href.includes("nominatim.openstreetmap.org")) {
        nominatimStartedAt.push(Date.now());
        return makeJsonResponse(nominatimFound(48.8566, 2.3522));
      }
      return new Response("", { status: 404 });
    });
    const { geocodeBatch } = await import("@/lib/geocoder");

    const resultPromise = geocodeBatch(["Paris", "London", "Berlin", "Tokyo", "Madrid"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_400);
    const result = await resultPromise;

    expect(result.size).toBe(5);
    expect(nominatimStartedAt).toHaveLength(5);
    expect(nominatimStartedAt).toEqual([0, 1100, 2200, 3300, 4400]);
  });
});
