// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { GET } from "@/app/api/explore/top/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}): NextRequest => {
  const url = new URL("http://localhost/api/explore/top");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

const userRow = { login: "alice", name: "Alice", followers: 100, company: null, publicRepos: 10, lat: 48.85, lng: 2.35, countryNormalized: "France" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/top", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindMany.mockResolvedValue([userRow]);
    mockCount.mockResolvedValue(1);
    // queryRaw used for unfiltered count estimate and UNION queries
    mockQueryRaw.mockResolvedValue([{ n: 1000000n }]);
  });

  // ── Input validation — filter guards (HIGH-3 regression) ──────────────────

  describe("filter guards", () => {
    it("returns 400 when country param is a single character", async () => {
      const res = await GET(makeReq({ country: "F" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when search param is a single character", async () => {
      const res = await GET(makeReq({ search: "a" }));
      expect(res.status).toBe(400);
    });

    it("accepts country with 2+ characters", async () => {
      mockQueryRaw.mockResolvedValue([{ cnt: 500n }]);
      mockFindMany.mockResolvedValue([userRow]);
      const res = await GET(makeReq({ country: "France" }));
      expect(res.status).toBe(200);
    });

    it("accepts search with 2+ characters", async () => {
      // search path uses $queryRaw for UNION
      mockQueryRaw.mockResolvedValue([userRow]);
      mockCount.mockResolvedValue(1);
      const res = await GET(makeReq({ search: "al" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Skip cap guard ────────────────────────────────────────────────────────

  describe("skip cap guard", () => {
    it("returns 400 when page exceeds the skip cap (page * size > 500)", async () => {
      // page=18, size=30 → skip=510 > MAX_SKIP=500
      const res = await GET(makeReq({ page: "18", size: "30" }));
      expect(res.status).toBe(400);
    });

    it("allows page within skip cap", async () => {
      // page=16, size=30 → skip=450 ≤ 500
      const res = await GET(makeReq({ page: "16", size: "30" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with items, total, page, pageSize", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(typeof json.total).toBe("number");
      expect(typeof json.page).toBe("number");
      expect(typeof json.pageSize).toBe("number");
    });

    it("derives avatarUrl from login", async () => {
      const res = await GET(makeReq());
      const json = await res.json();
      expect(json.items[0]?.avatarUrl).toBe("https://github.com/alice.png");
    });

    it("uses public CDN cache for unfiltered requests", async () => {
      const res = await GET(makeReq());
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });

    it("uses no-store for filtered requests", async () => {
      mockQueryRaw.mockResolvedValue([{ cnt: 500n }]);
      mockFindMany.mockResolvedValue([userRow]);
      const res = await GET(makeReq({ country: "France" }));
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockRejectedValue(new Error("connection refused"));
      const res = await GET(makeReq());
      expect(res.status).toBe(500);
    });
  });
});
