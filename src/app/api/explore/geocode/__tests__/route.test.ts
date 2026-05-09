// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGeocode = vi.fn();

vi.mock("@/lib/geocoder", () => ({
  geocode: (...args: unknown[]) => mockGeocode(...args),
}));

import { GET } from "@/app/api/explore/geocode/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/explore/geocode");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/geocode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.JAWGMAP_ACCESS_TOKEN;
    mockGeocode.mockResolvedValue([48.85, 2.35]);
  });

  // ── Forward geocode (text query) ──────────────────────────────────────────

  describe("forward geocode", () => {
    it("returns 400 when q is missing", async () => {
      const res = await GET(makeReq({}));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_query");
    });

    it("returns 400 when q is a single character", async () => {
      const res = await GET(makeReq({ q: "a" }));
      expect(res.status).toBe(400);
    });

    it("returns 404 when geocoder returns null (location not found)", async () => {
      mockGeocode.mockResolvedValue(null);
      const res = await GET(makeReq({ q: "xyzzy-nowhere" }));
      expect(res.status).toBe(404);
    });

    it("returns 200 with lat, lng, displayName for a found location", async () => {
      const res = await GET(makeReq({ q: "Paris" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.lat).toBe(48.85);
      expect(json.lng).toBe(2.35);
      expect(json.displayName).toBe("Paris");
    });
  });

  // ── Reverse geocode (lat + lng) ───────────────────────────────────────────

  describe("reverse geocode", () => {
    it("returns 400 for lat > 90", async () => {
      const res = await GET(makeReq({ lat: "91", lng: "2.35" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_coords");
    });

    it("returns 400 for lng > 180", async () => {
      const res = await GET(makeReq({ lat: "48.85", lng: "181" }));
      expect(res.status).toBe(400);
    });

    it("returns 200 with fallback displayName when Jawg token is absent", async () => {
      const res = await GET(makeReq({ lat: "48.85", lng: "2.35" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.lat).toBe(48.85);
      expect(json.lng).toBe(2.35);
      // fallback: "lat, lng" string
      expect(typeof json.displayName).toBe("string");
    });

    it("uses Jawg reverse geocode label when token is set", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ features: [{ properties: { label: "Paris, Île-de-France" } }] }),
          { status: 200 },
        ),
      );
      const res = await GET(makeReq({ lat: "48.85", lng: "2.35" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.displayName).toBe("Paris, Île-de-France");
    });

    it("includes Cache-Control header", async () => {
      const res = await GET(makeReq({ lat: "48.85", lng: "2.35" }));
      expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when geocoder throws", async () => {
      mockGeocode.mockRejectedValue(new Error("DB timeout"));
      const res = await GET(makeReq({ q: "Paris" }));
      expect(res.status).toBe(500);
    });
  });
});
