// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}));

import { GET } from "@/app/api/repos/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}) => {
  const url = new URL("http://localhost/api/repos");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
};

const makeRow = (owner: string, repo: string, overrides: Record<string, unknown> = {}) => ({
  owner,
  repo,
  mappedCount: 500,
  countryCount: 30,
  totalCount: 1000,
  language: "TypeScript",
  updatedAt: new Date("2026-01-01T12:00:00Z"),
  organicScore: null,
  organicTier: null,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/repos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindMany.mockResolvedValue([makeRow("octocat", "hello-world")]);
    mockCount.mockResolvedValue(1);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with repos array and total", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.repos)).toBe(true);
      expect(typeof json.total).toBe("number");
    });

    it("includes mappedPercent computed from mappedCount/totalCount", async () => {
      mockFindMany.mockResolvedValue([makeRow("octocat", "hello-world", { mappedCount: 500, totalCount: 1000 })]);
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].mappedPercent).toBe(50);
    });

    it("returns mappedPercent 0 when totalCount is 0 (avoids divide-by-zero)", async () => {
      mockFindMany.mockResolvedValue([makeRow("octocat", "hello-world", { mappedCount: 0, totalCount: 0 })]);
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].mappedPercent).toBe(0);
    });

    it("serializes updatedAt as ISO string", async () => {
      const json = await (await GET(makeReq())).json();
      expect(typeof json.repos[0].updatedAt).toBe("string");
      expect(json.repos[0].updatedAt).toContain("T");
    });

    it("includes null for organicScore when not set", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].organicScore).toBeNull();
    });

    it("returns empty repos array when DB has no entries", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);
      const json = await (await GET(makeReq())).json();
      expect(json.repos).toHaveLength(0);
      expect(json.total).toBe(0);
    });

    it("includes Cache-Control header for CDN caching", async () => {
      const res = await GET(makeReq());
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockFindMany.mockRejectedValue(new Error("connection refused"));
      const res = await GET(makeReq());
      expect(res.status).toBe(500);
    });
  });
});
