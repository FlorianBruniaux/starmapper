// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockBadgeCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    badgeCache: { count: (...args: unknown[]) => mockBadgeCount(...args) },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

import { GET } from "@/app/api/explore/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The route runs two $queryRaw calls via Promise.all:
//   [0] pg_class estimates (users + events)
//   [1] country_stats_mv (or fallback)
const estimatesRow = { users: 4_000_000n, events: 10_000_000n };
const countryRows = [{ country: "France" }, { country: "Germany" }];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw
      .mockResolvedValueOnce([estimatesRow]) // estimates
      .mockResolvedValueOnce(countryRows);   // country_stats_mv
    mockBadgeCount.mockResolvedValue(150);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with ExploreSummary fields", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(typeof json.totalUsers).toBe("number");
      expect(typeof json.totalTrackedRepos).toBe("number");
      expect(typeof json.totalStarEvents).toBe("number");
      expect(typeof json.totalCountries).toBe("number");
      expect(Array.isArray(json.countryList)).toBe(true);
    });

    it("converts bigint estimates to numbers", async () => {
      const json = await (await GET()).json();
      expect(json.totalUsers).toBe(4_000_000);
      expect(json.totalStarEvents).toBe(10_000_000);
    });

    it("reads totalTrackedRepos from badgeCache.count", async () => {
      const json = await (await GET()).json();
      expect(json.totalTrackedRepos).toBe(150);
    });

    it("builds countryList from country_stats_mv rows", async () => {
      const json = await (await GET()).json();
      expect(json.countryList).toContain("France");
      expect(json.countryList).toContain("Germany");
      expect(json.totalCountries).toBe(2);
    });

    it("returns Cache-Control s-maxage=3600", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when estimates query throws", async () => {
      mockQueryRaw.mockReset();
      mockBadgeCount.mockRejectedValue(new Error("connection refused"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
