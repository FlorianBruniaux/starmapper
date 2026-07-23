// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  JAWG_QUOTA_STATUSES,
  getJawgSlot,
  getJawgToken,
  hasJawgToken,
  jawgFetch,
  resetJawgTokens,
  switchJawgToken,
} from "@/lib/jawg-token";

const res = (status: number): Response => new Response("{}", { status });

/** Header token, used by the dedicated starmapper.jawg.io host. */
const readHeaderKey = (init?: RequestInit): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.["x-api-key"];

/** Query token, the only mode api.jawg.io/places accepts. */
const readQueryKey = (url: string): string | null =>
  new URL(url).searchParams.get("access-token");

describe("jawg-token", () => {
  beforeEach(() => {
    resetJawgTokens();
    vi.stubEnv("JAWG_TOKEN_HEADER", "geo_primary");
    vi.stubEnv("JAWG_TOKEN_HEADER_2", "geo_fallback");
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "places_primary");
    vi.stubEnv("JAWGMAP_ACCESS_TOKEN_2", "places_fallback");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetJawgTokens();
  });

  // ── Token resolution ────────────────────────────────────────────────────────

  describe("getJawgToken()", () => {
    it("returns the primary token on a fresh pool", () => {
      expect(getJawgToken("geocoding")).toBe("geo_primary");
      expect(getJawgToken("places")).toBe("places_primary");
    });

    it("keeps the two pools independent", () => {
      switchJawgToken("geocoding");
      expect(getJawgToken("geocoding")).toBe("geo_fallback");
      expect(getJawgToken("places")).toBe("places_primary");
    });

    it("returns undefined when neither token is configured", () => {
      vi.stubEnv("JAWG_TOKEN_HEADER", "");
      vi.stubEnv("JAWG_TOKEN_HEADER_2", "");
      expect(getJawgToken("geocoding")).toBeUndefined();
      expect(hasJawgToken("geocoding")).toBe(false);
    });

    it("uses the fallback token when only that one is configured", () => {
      vi.stubEnv("JAWG_TOKEN_HEADER", "");
      expect(getJawgToken("geocoding")).toBe("geo_fallback");
      expect(hasJawgToken("geocoding")).toBe(true);
    });
  });

  // ── Slot switching ──────────────────────────────────────────────────────────

  describe("switchJawgToken()", () => {
    it("moves the pool to slot 2 and returns the fallback token", () => {
      expect(getJawgSlot("geocoding")).toBe("1");
      expect(switchJawgToken("geocoding")).toBe("geo_fallback");
      expect(getJawgSlot("geocoding")).toBe("2");
    });

    it("returns undefined on a second switch — nothing left to try", () => {
      switchJawgToken("geocoding");
      expect(switchJawgToken("geocoding")).toBeUndefined();
      expect(getJawgSlot("geocoding")).toBe("2");
    });

    it("returns undefined and stays on slot 1 when no fallback is configured", () => {
      vi.stubEnv("JAWG_TOKEN_HEADER_2", "");
      expect(switchJawgToken("geocoding")).toBeUndefined();
      expect(getJawgSlot("geocoding")).toBe("1");
      expect(getJawgToken("geocoding")).toBe("geo_primary");
    });

    it("reverts to the primary after the 1h retry window", () => {
      const t0 = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(t0);
      switchJawgToken("geocoding");
      expect(getJawgSlot("geocoding")).toBe("2");

      vi.spyOn(Date, "now").mockReturnValue(t0 + 59 * 60 * 1000);
      expect(getJawgSlot("geocoding")).toBe("2");

      vi.spyOn(Date, "now").mockReturnValue(t0 + 60 * 60 * 1000);
      expect(getJawgSlot("geocoding")).toBe("1");
      expect(getJawgToken("geocoding")).toBe("geo_primary");
    });
  });

  // ── jawgFetch ───────────────────────────────────────────────────────────────

  describe("jawgFetch()", () => {
    it("sends the primary token as an access-token query param for the places pool", async () => {
      const fetcher = vi.fn().mockResolvedValue(res(200));
      const out = await jawgFetch("places", "https://api.jawg.io/x?text=Paris", undefined, fetcher);

      expect(out?.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(readQueryKey(fetcher.mock.calls[0][0])).toBe("places_primary");
      // api.jawg.io rejects header auth with HTTP 400, so nothing must be sent there
      expect(readHeaderKey(fetcher.mock.calls[0][1])).toBeUndefined();
    });

    it("sends the primary token as an x-api-key header for the geocoding pool", async () => {
      const fetcher = vi.fn().mockResolvedValue(res(200));
      await jawgFetch("geocoding", "https://starmapper.jawg.io/x", undefined, fetcher);

      expect(readHeaderKey(fetcher.mock.calls[0][1])).toBe("geo_primary");
      expect(fetcher.mock.calls[0][0]).toBe("https://starmapper.jawg.io/x");
    });

    it("appends the query token with ? when the URL has no query string", async () => {
      const fetcher = vi.fn().mockResolvedValue(res(200));
      await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher);

      expect(fetcher.mock.calls[0][0]).toBe("https://api.jawg.io/x?access-token=places_primary");
    });

    it.each([...JAWG_QUOTA_STATUSES])(
      "retries with the fallback token on HTTP %i",
      async (status) => {
        const fetcher = vi
          .fn()
          .mockResolvedValueOnce(res(status))
          .mockResolvedValueOnce(res(200));

        const out = await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher);

        expect(out?.status).toBe(200);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(readQueryKey(fetcher.mock.calls[0][0])).toBe("places_primary");
        expect(readQueryKey(fetcher.mock.calls[1][0])).toBe("places_fallback");
      },
    );

    it("does not retry on a non-quota error status", async () => {
      const fetcher = vi.fn().mockResolvedValue(res(500));
      const out = await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher);

      expect(out?.status).toBe(500);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(getJawgSlot("places")).toBe("1");
    });

    it("does not retry when no fallback token exists, and returns the failed response", async () => {
      vi.stubEnv("JAWGMAP_ACCESS_TOKEN_2", "");
      const fetcher = vi.fn().mockResolvedValue(res(429));
      const out = await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher);

      expect(out?.status).toBe(429);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns null without calling fetch when the pool has no token", async () => {
      vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "");
      vi.stubEnv("JAWGMAP_ACCESS_TOKEN_2", "");
      const fetcher = vi.fn();

      expect(await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("uses the fallback directly once the pool has already switched", async () => {
      switchJawgToken("places");
      const fetcher = vi.fn().mockResolvedValue(res(200));
      await jawgFetch("places", "https://api.jawg.io/x", undefined, fetcher);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(readQueryKey(fetcher.mock.calls[0][0])).toBe("places_fallback");
    });

    it("preserves caller-supplied headers and init options", async () => {
      const fetcher = vi.fn().mockResolvedValue(res(200));
      await jawgFetch(
        "places",
        "https://api.jawg.io/x",
        { headers: { Accept: "application/json" }, method: "GET" },
        fetcher,
      );

      const init = fetcher.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>).Accept).toBe("application/json");
      expect(readQueryKey(fetcher.mock.calls[0][0])).toBe("places_primary");
    });
  });
});
