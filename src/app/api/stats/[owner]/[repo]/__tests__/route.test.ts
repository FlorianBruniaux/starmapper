// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBadgeFindUnique = vi.fn();
const mockQueryRaw = vi.fn();
const mockUserFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: { findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    gitHubUser: { findMany: (...args: unknown[]) => mockUserFindMany(...args) },
  },
}));

vi.mock("@/lib/location-parser", () => ({
  parseLocation: (loc: string) => {
    if (loc === "Paris, France") return { country: "France", city: "Paris" };
    return { country: null, city: null };
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (owner: string, repo: string) => ({
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
  }),
}));

import { GET } from "@/app/api/stats/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const totalsRow = {
  total: 1000n,
  mapped: 800n,
  avg_followers: 50,
  enriched: 500n,
  bots: 10n,
};

const badgeRow = {
  totalCount: 1000,
  mappedCount: 800,
  countryCount: 30,
  organicScore: null,
  organicTier: null,
  organicComputedAt: null,
  forksCount: null,
  watchersCount: null,
  openIssuesCount: null,
  openPRsCount: null,
  latestReleaseTag: null,
  latestReleaseUrl: null,
  latestReleaseAt: null,
  releasesCount: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/stats/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBadgeFindUnique.mockResolvedValue(null);
    mockQueryRaw
      .mockResolvedValueOnce([totalsRow])    // totals JOIN
      .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }]) // locationRows
      .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])          // companyRows
      .mockResolvedValueOnce([]);                                         // crossRepoGroups
    mockUserFindMany.mockResolvedValue([]);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner (spaces)", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid repo (special chars)", async () => {
      const [req, ctx] = makeReq("facebook", "bad repo!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── No data ───────────────────────────────────────────────────────────────

  describe("no data", () => {
    it("returns 404 when no star_event rows and no badge_cache", async () => {
      mockBadgeFindUnique.mockResolvedValue(null);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockResolvedValueOnce([]); // totals empty
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("falls back to badge_cache totals when totals query returns 0 rows", async () => {
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockResolvedValueOnce([]); // empty totals — triggers joinTimedOut path
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.totalStars).toBe(1000);
      expect(json.isPartial).toBe(true);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with correct stats fields", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(typeof json.totalStars).toBe("number");
      expect(typeof json.mappedCount).toBe("number");
      expect(typeof json.mappingRate).toBe("number");
      expect(Array.isArray(json.topCountries)).toBe(true);
      expect(Array.isArray(json.topCities)).toBe(true);
      expect(Array.isArray(json.topCompanies)).toBe(true);
      expect(Array.isArray(json.powerStargazers)).toBe(true);
    });

    it("computes mappingRate as percentage of mapped / total", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      expect(json.mappingRate).toBe(80); // 800/1000 * 100
    });

    it("includes topCountries from locationRows", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      const countries = json.topCountries.map(([name]: [string]) => name);
      expect(countries).toContain("France");
    });

    it("includes topCompanies from companyRows", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      const companies = json.topCompanies.map(([name]: [string]) => name);
      expect(companies).toContain("Google");
    });

    it("includes Cache-Control with s-maxage=300", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Timeout handling ──────────────────────────────────────────────────────

  describe("Neon timeout handling", () => {
    it("returns isPartial=true with badge_cache fallback on totals timeout", async () => {
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValueOnce(
        new Error("57014 canceling statement due to statement timeout"),
      );
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isPartial).toBe(true);
      expect(json.totalStars).toBe(1000);
    });

    it("returns 404 on totals timeout when badge_cache is missing", async () => {
      mockBadgeFindUnique.mockResolvedValue(null);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValueOnce(
        new Error("57014 canceling statement due to statement timeout"),
      );
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("logs the repo identity (not '[object Object]') on totals timeout", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValueOnce(
        new Error("57014 canceling statement due to statement timeout"),
      );
      const [req, ctx] = makeReq("facebook", "react");
      await GET(req, ctx);
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("facebook/react");
      expect(logged).not.toContain("[object Object]");
      errorSpy.mockRestore();
    });

    it("logs the repo identity on a power-users timeout", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([totalsRow])
        .mockResolvedValueOnce([]) // locationRows
        .mockResolvedValueOnce([]) // companyRows
        .mockRejectedValueOnce(
          new Error("57014 canceling statement due to statement timeout"),
        ); // crossRepoGroups (power-users)
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("stats/power-users timeout [facebook/react]");
      expect(logged).not.toContain("[object Object]");
      errorSpy.mockRestore();
    });

    it("reduces Cache-Control TTL when the response is partial", async () => {
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValueOnce(
        new Error("57014 canceling statement due to statement timeout"),
      );
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const cacheControl = res.headers.get("cache-control");
      expect(cacheControl).toContain("s-maxage=30");
      expect(cacheControl).not.toContain("s-maxage=300");
    });

    it("keeps the full 5-minute Cache-Control TTL on a non-partial response", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 on non-timeout DB error", async () => {
      mockBadgeFindUnique.mockRejectedValue(new Error("connection refused"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });

  // ── Precomputed path (REPO_STATS_MV_ENABLED) ───────────────────────────────

  describe("REPO_STATS_MV_ENABLED off (default)", () => {
    it("issues exactly the 4 live queries, in the historical order", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      await GET(req, ctx);
      // The whole non-regression guarantee of the flag: no repo_stats_mv probe is added
      // ahead of the live sequence, so the positional mocks in beforeEach still line up.
      expect(mockQueryRaw).toHaveBeenCalledTimes(4);
    });

    it("omits source and computedAt entirely", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const body = await (await GET(req, ctx)).json();
      expect(body.source).toBeUndefined();
      expect(body.computedAt).toBeUndefined();
    });
  });

  describe("REPO_STATS_MV_ENABLED on", () => {
    const mvRow = {
      total: 2000n,
      mapped: 1500n,
      avg_followers: 77,
      enriched: 900n,
      bots: 20n,
      computed_at: new Date("2026-07-23T02:00:00.000Z"),
    };

    beforeEach(() => {
      vi.stubEnv("REPO_STATS_MV_ENABLED", "true");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("serves repo_stats_mv and never touches the live join", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([mvRow]) // repo_stats_mv
        .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])
        .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const body = await (await GET(req, ctx)).json();

      expect(body.source).toBe("precomputed");
      expect(body.totalStars).toBe(2000);
      expect(body.mappedCount).toBe(1500);
      expect(body.avgFollowers).toBe(77);
      expect(body.enrichedUserCount).toBe(900);
      expect(body.botCount).toBe(20);
      expect(body.isPartial).toBeUndefined();
      // 1 scalar view + 3 dimension views, and not one live aggregate.
      expect(mockQueryRaw).toHaveBeenCalledTimes(4);
    });

    it("serialises computedAt as ISO 8601", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([mvRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const body = await (await GET(req, ctx)).json();
      expect(body.computedAt).toBe("2026-07-23T02:00:00.000Z");
    });

    it("serialises computedAt when the driver hands back a string", async () => {
      // NOW() is a timestamptz (OID 1184), not the timestamp(3) the adapter is known to
      // decode into a Date. If it ever arrives as a string, .toISOString() on it would
      // throw and 500 every precomputed repo. Only new Date(...) covers both.
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([{ ...mvRow, computed_at: "2026-07-23T02:00:00.000Z" }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).computedAt).toBe("2026-07-23T02:00:00.000Z");
    });

    it("caches a complete precomputed response for 15 minutes", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([mvRow])
        .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])
        .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=900");
      expect((await res.json()).isPartial).toBeUndefined();
    });

    it("degrades instead of 500ing when a dimension view is missing", async () => {
      // Realistic after an interrupted build: create-repo-stats-mvs.sql commits one CREATE
      // at a time, so repo_stats_mv can exist while the dimension views do not. Letting
      // 42P01 propagate would 500 every repo the scalar view knows about.
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([mvRow])
        .mockRejectedValueOnce(new Error('relation "repo_location_stats_mv" does not exist'))
        .mockRejectedValueOnce(new Error('relation "repo_company_stats_mv" does not exist'))
        .mockRejectedValueOnce(new Error('relation "repo_power_users_mv" does not exist'));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalStars).toBe(2000);
      expect(body.topCountries).toEqual([]);
      expect(body.isPartial).toBe(true);
      expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    });

    it("marks a precomputed response partial when part=2 has not run yet", async () => {
      // repo_stats_mv refreshed at 02:00, dimension views still empty for this repo until
      // 02:20. Serving that for 900s would pin an empty stats panel in the CDN.
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([mvRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect((await res.json()).isPartial).toBe(true);
      expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    });

    it("falls back to the live path when the repo is absent from the view", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([]) // repo_stats_mv miss
        .mockResolvedValueOnce([totalsRow])
        .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])
        .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const body = await res.json();
      expect(body.source).toBe("live");
      expect(body.totalStars).toBe(1000);
      expect(body.computedAt).toBeUndefined();
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });

    it("falls back to the live path when repo_stats_mv does not exist yet", async () => {
      // Flag switched on before the migration ran. Must degrade to today's behaviour
      // instead of 500ing every repo.
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockRejectedValueOnce(new Error('relation "repo_stats_mv" does not exist'))
        .mockResolvedValueOnce([totalsRow])
        .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])
        .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])
        .mockResolvedValueOnce([]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).source).toBe("live");
    });

    it("still returns isPartial with a 30s TTL when the view misses and live times out", async () => {
      mockBadgeFindUnique.mockResolvedValue(badgeRow);
      mockQueryRaw.mockReset();
      mockQueryRaw
        .mockResolvedValueOnce([]) // repo_stats_mv miss
        .mockRejectedValueOnce(
          new Error("57014 canceling statement due to statement timeout"),
        );
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const body = await res.json();
      expect(body.isPartial).toBe(true);
      expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    });
  });
});
