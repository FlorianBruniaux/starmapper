// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { GET } from "@/app/api/admin/organic-score-stats/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/organic-score-stats");

// The new implementation runs two $queryRaw calls in Promise.all:
//   1st call → tier rows  { tier, cnt, stale_count, avg_score }
//   2nd call → bucket rows { bucket, cnt }
const tierRows = [
  { tier: "healthy",  cnt: 1, stale_count: 0, avg_score: 85 },
  { tier: "moderate", cnt: 1, stale_count: 0, avg_score: 45 },
  { tier: "none",     cnt: 1, stale_count: 0, avg_score: null },
];
const bucketRows = [
  { bucket: 4, cnt: 1 }, // score 45 → bucket 4 (40-49)
  { bucket: 8, cnt: 1 }, // score 85 → bucket 8 (80-89)
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/organic-score-stats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireAdminAuth.mockReturnValue(null);
    mockQueryRaw
      .mockResolvedValueOnce(tierRows)
      .mockResolvedValueOnce(bucketRows);
  });

  it("returns 404 when admin auth fails", async () => {
    mockRequireAdminAuth.mockReturnValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns stats with tierCounts, avgScore, distribution", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.totalBadgeCacheRows).toBe("number");
    expect(typeof json.tierCounts.healthy).toBe("number");
    expect(typeof json.avgScore).toBe("number");
    expect(Array.isArray(json.distribution)).toBe(true);
  });

  it("counts none tier for rows without organicTier", async () => {
    const json = await (await GET(makeReq())).json();
    expect(json.tierCounts.none).toBe(1);
  });

  it("computes avgScore as weighted mean of scored tiers", async () => {
    const json = await (await GET(makeReq())).json();
    expect(json.avgScore).toBe(Math.round((85 + 45) / 2)); // 65
  });

  it("returns 500 when DB throws", async () => {
    vi.resetAllMocks();
    mockRequireAdminAuth.mockReturnValue(null);
    mockQueryRaw.mockRejectedValue(new Error("DB down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
