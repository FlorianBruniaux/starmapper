// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

import { GET } from "@/app/api/explore/global-map/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mvRow = { lat: 48.8, lng: 2.3, count: 500, total_followers: 10000, top_login: "torvalds" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/global-map", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([mvRow]);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with cells and totalMapped", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.cells)).toBe(true);
      expect(typeof json.totalMapped).toBe("number");
    });

    it("maps lat/lng/count/totalFollowers/topLogin per cell", async () => {
      const json = await (await GET()).json();
      const cell = json.cells[0];
      expect(cell.lat).toBe(48.8);
      expect(cell.count).toBe(500);
      expect(cell.totalFollowers).toBe(10000);
      expect(cell.topLogin).toBe("torvalds");
    });

    it("computes totalMapped as sum of cell counts", async () => {
      const json = await (await GET()).json();
      expect(json.totalMapped).toBe(500);
    });

    it("returns Cache-Control with s-maxage=3600 on MV hit", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });
  });

  // ── MV missing fallback ───────────────────────────────────────────────────

  describe("MV missing fallback", () => {
    it("falls back to direct scan when MV is missing (42P01)", async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error("42P01: relation does not exist"))
        .mockResolvedValueOnce([mvRow]);
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.totalMapped).toBe(500);
    });

    it("returns no CDN s-maxage on fallback path", async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error("42P01: relation does not exist"))
        .mockResolvedValueOnce([mvRow]);
      const res = await GET();
      const cc = res.headers.get("cache-control");
      expect(cc ?? "").not.toContain("s-maxage");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 on non-42P01 DB error", async () => {
      mockQueryRaw.mockRejectedValue(new Error("connection refused"));
      const res = await GET();
      expect(res.status).toBe(500);
    });

    it("returns 500 when both MV and fallback queries fail", async () => {
      mockQueryRaw
        .mockRejectedValueOnce(new Error("42P01: relation does not exist"))
        .mockRejectedValueOnce(new Error("fallback also failed"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });
});
