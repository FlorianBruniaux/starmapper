// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Upstash — stub so getAutocompleteLimiter() fails-open in tests.
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    async limit() { return { success: true }; }
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

import { GET } from "@/app/api/explore/autocomplete/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (q: string | null): NextRequest => {
  const url = new URL("http://localhost/api/explore/autocomplete");
  if (q !== null) url.searchParams.set("q", q);
  return new NextRequest(url.toString());
};

const jawgFeature = (label: string, lat: number, lng: number) => ({
  properties: { label },
  geometry: { coordinates: [lng, lat] },
});

const jawgOk = (features: unknown[]) =>
  new Response(JSON.stringify({ features }), { status: 200 });

const nominatimResult = (label: string) => ({ display_name: label, lat: "48.85", lon: "2.35" });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/autocomplete", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jawgOk([jawgFeature("Paris, France", 48.85, 2.35)])));
    delete process.env.JAWGMAP_ACCESS_TOKEN;
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when q param is missing", async () => {
      const res = await GET(makeReq(null));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_query");
    });

    it("returns 400 when q is a single character", async () => {
      const res = await GET(makeReq("a"));
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty string", async () => {
      const res = await GET(makeReq(""));
      expect(res.status).toBe(400);
    });

    it("accepts query with 2+ characters", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      const res = await GET(makeReq("Pa"));
      expect(res.status).toBe(200);
    });
  });

  // ── Provider fallback ─────────────────────────────────────────────────────

  describe("provider fallback", () => {
    it("uses Jawg results when token is set and Jawg returns results", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch).mockResolvedValue(jawgOk([jawgFeature("Paris", 48.85, 2.35)]));
      const json = await (await GET(makeReq("Paris"))).json();
      expect(json[0].label).toBe("Paris");
      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });

    it("falls back to Nominatim when JAWGMAP_ACCESS_TOKEN is absent", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify([nominatimResult("Paris, Île-de-France, France")]), { status: 200 }),
      );
      const json = await (await GET(makeReq("Paris"))).json();
      expect(json[0].label).toContain("Paris");
      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });

    it("falls back to Nominatim when Jawg token is set but returns empty features", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch)
        .mockResolvedValueOnce(jawgOk([]))  // Jawg empty
        .mockResolvedValueOnce(
          new Response(JSON.stringify([nominatimResult("Paris, France")]), { status: 200 }),
        );
      const json = await (await GET(makeReq("Paris"))).json();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      expect(json[0].label).toContain("Paris");
    });

    it("returns empty array when both providers return empty results", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch)
        .mockResolvedValueOnce(jawgOk([]))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
      const json = await (await GET(makeReq("xyzzy"))).json();
      expect(json).toHaveLength(0);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns label, lat, lng per result", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch).mockResolvedValue(jawgOk([jawgFeature("Paris", 48.85, 2.35)]));
      const json = await (await GET(makeReq("Paris"))).json();
      const item = json[0];
      expect(typeof item.label).toBe("string");
      expect(typeof item.lat).toBe("number");
      expect(typeof item.lng).toBe("number");
    });

    it("includes Cache-Control header", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      const res = await GET(makeReq("Paris"));
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when fetch throws unexpectedly", async () => {
      process.env.JAWGMAP_ACCESS_TOKEN = "test-token";
      vi.mocked(fetch).mockRejectedValue(new Error("network error"));
      const res = await GET(makeReq("Paris"));
      expect(res.status).toBe(500);
    });
  });
});
