// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockCacheFindMany = vi.fn();
const mockDecompress = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    stargazerCache: { findMany: (...args: unknown[]) => mockCacheFindMany(...args) },
  },
}));

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: (...args: unknown[]) => mockDecompress(...args),
}));

import { GET } from "@/app/api/trending/map/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fakePoint = { login: "alice", lat: 48.85, lng: 2.35, avatarUrl: null };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/trending/map", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([{ owner: "vercel", repo: "next.js" }]);
    mockCacheFindMany.mockResolvedValue([]);
    mockDecompress.mockReturnValue([]);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with mapPoints array — no repos", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.mapPoints)).toBe(true);
      expect(json.repos).toBeUndefined();
    });

    it("passes at most 5 owner/repo pairs to stargazerCache.findMany", async () => {
      mockQueryRaw.mockResolvedValue([
        { owner: "a", repo: "1" },
        { owner: "b", repo: "2" },
        { owner: "c", repo: "3" },
        { owner: "d", repo: "4" },
        { owner: "e", repo: "5" },
      ]);
      await GET();
      const args = mockCacheFindMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } };
      expect(args.where.OR).toHaveLength(5);
    });

    it("deduplicates users across repos (first occurrence wins)", async () => {
      const point1 = { ...fakePoint, login: "alice", lat: 48.85, lng: 2.35 };
      const point2 = { ...fakePoint, login: "alice", lat: 40.71, lng: -74.01 };
      mockCacheFindMany.mockResolvedValue([
        { owner: "vercel", repo: "next.js", points: "gz1" },
        { owner: "facebook", repo: "react", points: "gz2" },
      ]);
      mockDecompress
        .mockReturnValueOnce([point1])
        .mockReturnValueOnce([point2]);

      const json = await (await GET()).json();
      const alicePoints = json.mapPoints.filter((p: { login: string }) => p.login === "alice");
      expect(alicePoints).toHaveLength(1);
      expect(alicePoints[0].lat).toBe(48.85);
    });

    it("falls back to github avatar URL when avatarUrl is null", async () => {
      mockCacheFindMany.mockResolvedValue([{ owner: "vercel", repo: "next.js", points: "gz" }]);
      mockDecompress.mockReturnValue([fakePoint]);

      const json = await (await GET()).json();
      expect(json.mapPoints[0].avatarUrl).toBe("https://github.com/alice.png");
    });

    it("rounds lat/lng to 2 decimal places", async () => {
      mockCacheFindMany.mockResolvedValue([{ owner: "vercel", repo: "next.js", points: "gz" }]);
      mockDecompress.mockReturnValue([{ ...fakePoint, lat: 48.856614, lng: 2.352222 }]);

      const json = await (await GET()).json();
      expect(json.mapPoints[0].lat).toBe(48.86);
      expect(json.mapPoints[0].lng).toBe(2.35);
    });

    it("returns empty mapPoints when no cache entries exist", async () => {
      mockCacheFindMany.mockResolvedValue([]);
      const json = await (await GET()).json();
      expect(json.mapPoints).toHaveLength(0);
    });
  });

  // ── Cache-Control ─────────────────────────────────────────────────────────

  describe("Cache-Control", () => {
    it("includes s-maxage=3600", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });

    it("includes stale-while-revalidate=7200", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("stale-while-revalidate=7200");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockRejectedValue(new Error("query failed"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
