// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockCacheFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    stargazerCache: { findMany: (...args: unknown[]) => mockCacheFindMany(...args) },
  },
}));

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: () => [],
}));

import { GET } from "@/app/api/trending/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mvRow = {
  owner: "vercel",
  repo: "next.js",
  stars_7d: 100n,
  stars_30d: 400n,
  stars_90d: 1000n,
  language: "TypeScript",
  total_count: 100000n,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/trending", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([mvRow]);
    mockCacheFindMany.mockResolvedValue([]);
  });

  // ── Empty MV fallback ─────────────────────────────────────────────────────

  describe("empty MV fallback", () => {
    it("returns 503 with trending_mv_empty when MV has no rows", async () => {
      mockQueryRaw.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("trending_mv_empty");
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with repos, mapPoints, meta.total", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.repos)).toBe(true);
      expect(Array.isArray(json.mapPoints)).toBe(true);
      expect(typeof json.meta.total).toBe("number");
    });

    it("assigns rank starting at 1", async () => {
      const json = await (await GET()).json();
      expect(json.repos[0].rank).toBe(1);
    });

    it("converts bigint fields to numbers in response", async () => {
      const json = await (await GET()).json();
      const repo = json.repos[0];
      expect(typeof repo.stars7d).toBe("number");
      expect(typeof repo.totalCount).toBe("number");
    });

    it("marks repos without a stargazer_cache entry as hasMap=false", async () => {
      mockCacheFindMany.mockResolvedValue([]);
      const json = await (await GET()).json();
      expect(json.repos[0].hasMap).toBe(false);
    });

    it("marks repos with a stargazer_cache entry as hasMap=true", async () => {
      mockCacheFindMany.mockResolvedValue([{ owner: "vercel", repo: "next.js", points: "gz" }]);
      const json = await (await GET()).json();
      expect(json.repos[0].hasMap).toBe(true);
    });

    it("includes Cache-Control header with s-maxage=3600", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockRejectedValue(new Error("MV timeout"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
