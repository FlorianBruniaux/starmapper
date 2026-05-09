// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Setup ───────────────────────────────────────────────────────────────────

// Each test group uses a unique URL prefix to avoid cross-test in-memory cache hits.
let urlCounter = 0;
const uniqueUrl = () => `https://tile.jawg.io/style-${++urlCounter}.json?token=t`;

type JawgStyle = {
  projection?: unknown;
  layers?: Array<{ id?: string; layout?: { "text-font"?: string[] }; "source-layer"?: string }>;
  sources?: Record<string, { attribution?: string }>;
};

const makeStyle = (overrides: Partial<JawgStyle> = {}): JawgStyle => ({
  layers: [],
  sources: {},
  ...overrides,
});

const mockFetch = (body: unknown, ok = true) => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    }),
  );
};

import { fetchAndPatchStyle } from "@/lib/map-style";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fetchAndPatchStyle()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  // ── In-memory cache ────────────────────────────────────────────────────────

  describe("in-memory cache", () => {
    it("returns cached result without calling fetch on second call", async () => {
      const url = uniqueUrl();
      mockFetch(makeStyle());
      await fetchAndPatchStyle(url);
      await fetchAndPatchStyle(url);
      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });

    it("separate cache entries for different projections on same URL", async () => {
      const url = uniqueUrl();
      mockFetch(makeStyle());
      mockFetch(makeStyle());
      await fetchAndPatchStyle(url, "mercator");
      await fetchAndPatchStyle(url, "globe");
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  // ── Projection patch ───────────────────────────────────────────────────────

  describe("projection patch", () => {
    it("sets projection to mercator by default", async () => {
      const url = uniqueUrl();
      mockFetch(makeStyle());
      const result = await fetchAndPatchStyle(url);
      expect(result).toMatchObject({ projection: { type: "mercator" } });
    });

    it("sets projection to globe when specified", async () => {
      const url = uniqueUrl();
      mockFetch(makeStyle());
      const result = await fetchAndPatchStyle(url, "globe");
      expect(result).toMatchObject({ projection: { type: "globe" } });
    });
  });

  // ── Font patch ────────────────────────────────────────────────────────────

  describe("font patch", () => {
    it("replaces Noto Sans with Open Sans in text-font arrays", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          layers: [{ id: "label", layout: { "text-font": ["Noto Sans Bold", "Noto Sans Regular"] } }],
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      const fonts = result.layers![0]?.layout?.["text-font"];
      expect(fonts).toEqual(["Open Sans Bold", "Open Sans Regular"]);
    });

    it("leaves non-Noto fonts unchanged", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          layers: [{ id: "label", layout: { "text-font": ["Open Sans Regular"] } }],
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.layers![0]?.layout?.["text-font"]).toEqual(["Open Sans Regular"]);
    });
  });

  // ── Layer filtering ───────────────────────────────────────────────────────

  describe("layer filtering", () => {
    it("removes layers with source-layer 'water_name'", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          layers: [
            { id: "land", "source-layer": "land" },
            { id: "water-labels", "source-layer": "water_name" },
          ],
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.layers!.map((l) => l.id)).toEqual(["land"]);
    });

    it("removes layers with source-layer 'marine'", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          layers: [
            { id: "land", "source-layer": "land" },
            { id: "sea-label", "source-layer": "marine" },
          ],
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.layers!.map((l) => l.id)).toEqual(["land"]);
    });

    it("removes layers whose id matches /ocean|marine|water.?name/i", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          layers: [
            { id: "ocean-label" },
            { id: "marine-label" },
            { id: "water-name-layer" },
            { id: "road" },
          ],
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.layers!.map((l) => l.id)).toEqual(["road"]);
    });
  });

  // ── Attribution patch ─────────────────────────────────────────────────────

  describe("attribution patch", () => {
    it("replaces utm_source in Jawg attribution links", async () => {
      const url = uniqueUrl();
      mockFetch(
        makeStyle({
          sources: {
            jawg: {
              attribution:
                '<a href="https://jawg.io?utm_source=other">Jawg Maps</a>',
            },
          },
        }),
      );
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.sources!["jawg"].attribution).toContain("utm_source=starmapper");
      expect(result.sources!["jawg"].attribution).not.toContain("utm_source=other");
    });

    it("leaves non-Jawg attribution unchanged", async () => {
      const url = uniqueUrl();
      const original = '<a href="https://openstreetmap.org">OSM</a>';
      mockFetch(makeStyle({ sources: { osm: { attribution: original } } }));
      const result = await fetchAndPatchStyle(url) as JawgStyle;
      expect(result.sources!["osm"].attribution).toBe(original);
    });
  });

  // ── Fallback behavior ─────────────────────────────────────────────────────

  describe("fallback behavior", () => {
    it("returns the raw URL string when fetch returns non-ok status", async () => {
      const url = uniqueUrl();
      mockFetch({}, false);
      const result = await fetchAndPatchStyle(url);
      expect(result).toBe(url);
    });

    it("returns the raw URL string when fetch throws", async () => {
      const url = uniqueUrl();
      vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));
      const result = await fetchAndPatchStyle(url);
      expect(result).toBe(url);
    });

    it("returns the raw URL string when response is not a valid object", async () => {
      const url = uniqueUrl();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('"just a string"', { status: 200 }),
      );
      const result = await fetchAndPatchStyle(url);
      expect(result).toBe(url);
    });

    it("caches the fallback URL so subsequent calls also return the URL", async () => {
      const url = uniqueUrl();
      vi.mocked(fetch).mockRejectedValueOnce(new Error("fail"));
      await fetchAndPatchStyle(url);
      // Second call — should use in-memory cache, not call fetch again
      const result = await fetchAndPatchStyle(url);
      expect(result).toBe(url);
      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });
  });
});
