// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
