// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Covers tier 2 of the geocoding waterfall: the shared Jawg Places API used when the
 * dedicated `starmapper.jawg.io` host is unreachable.
 *
 * Lives in its own file on purpose. geocoder.ts holds module-level circuit breakers, and
 * geocoder.test.ts opens the Jawg breaker in its later blocks. Asserting on the exact fetch
 * sequence requires a process where no provider has been tripped yet, which `pool: "forks"`
 * guarantees per file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@vercel/functions", () => ({
  getCache: () => ({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    expireTag: vi.fn(),
    delete: vi.fn(),
  }),
}));

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

import { geocode } from "@/lib/geocoder";
import { resetJawgTokens } from "@/lib/jawg-token";

const makeJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Pelias shape, returned identically by both Jawg hosts. */
const pelias = (lat: number, lng: number) => ({ features: [{ geometry: { coordinates: [lng, lat] } }] });

describe("geocoding waterfall — shared Jawg tier", () => {
  beforeEach(() => {
    resetJawgTokens();
    vi.stubEnv("JAWG_TOKEN_HEADER", "test_dedicated_token");
    vi.stubEnv("GEOAPIFY_APIKEY", "test_geoapify_key");
    mockFindUnique.mockResolvedValue(null); // cache miss
    mockUpsert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetJawgTokens();
  });

  it("uses the dedicated host first and never reaches the shared API when it succeeds", async () => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_places_token");
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(makeJsonResponse(pelias(48.8566, 2.3522)));

    expect(await geocode("Paris")).toEqual([48.8566, 2.3522]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("starmapper.jawg.io");
  });

  it("falls back to api.jawg.io when the dedicated host fails", async () => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_places_token");
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(makeJsonResponse(pelias(45.764, 4.8357)));

    expect(await geocode("Lyon")).toEqual([45.764, 4.8357]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1]?.[0])).toContain("https://api.jawg.io/places/v1/search");
  });

  it("authenticates the shared API with an access-token query param, not a header", async () => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_places_token");
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(makeJsonResponse(pelias(45.764, 4.8357)));

    await geocode("Lyon");

    const [url, init] = spy.mock.calls[1] as [string, RequestInit];
    expect(new URL(String(url)).searchParams.get("access-token")).toBe("test_places_token");
    expect((init?.headers as Record<string, string> | undefined)?.["x-api-key"]).toBeUndefined();
  });

  it("authenticates the dedicated host with an x-api-key header, not a query param", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(makeJsonResponse(pelias(48.8566, 2.3522)));

    await geocode("Paris");

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test_dedicated_token");
    expect(new URL(String(url)).searchParams.get("access-token")).toBeNull();
  });

  it("skips the shared tier and reaches Geoapify when no places token is configured", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 })) // dedicated host down
      .mockResolvedValueOnce(makeJsonResponse(pelias(45.764, 4.8357))); // Geoapify

    expect(await geocode("Lyon")).toEqual([45.764, 4.8357]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1]?.[0])).toContain("api.geoapify.com");
  });

  it("continues to Geoapify when both Jawg tiers fail", async () => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_places_token");
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 })) // dedicated
      .mockResolvedValueOnce(new Response("", { status: 500 })) // shared
      .mockResolvedValueOnce(makeJsonResponse(pelias(45.764, 4.8357))); // Geoapify

    expect(await geocode("Lyon")).toEqual([45.764, 4.8357]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(String(spy.mock.calls[2]?.[0])).toContain("api.geoapify.com");
  });

  it("switches to the secondary places token when the shared API reports a quota error", async () => {
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "places_primary");
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN_2", "places_fallback");
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 })) // dedicated down
      .mockResolvedValueOnce(new Response("", { status: 429 })) // shared, primary token exhausted
      .mockResolvedValueOnce(makeJsonResponse(pelias(45.764, 4.8357))); // shared, fallback token

    expect(await geocode("Lyon")).toEqual([45.764, 4.8357]);
    expect(new URL(String(spy.mock.calls[1]?.[0])).searchParams.get("access-token")).toBe("places_primary");
    expect(new URL(String(spy.mock.calls[2]?.[0])).searchParams.get("access-token")).toBe("places_fallback");
  });
});
