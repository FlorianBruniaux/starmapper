// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockBadgeFindMany = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: { findMany: (...args: unknown[]) => mockBadgeFindMany(...args) },
  },
}));

import { GET } from "@/app/api/admin/organic-score-stats/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/organic-score-stats");

const rows = [
  { organicScore: 85, organicTier: "healthy", organicComputedAt: new Date() },
  { organicScore: 45, organicTier: "moderate", organicComputedAt: new Date() },
  { organicScore: null, organicTier: null, organicComputedAt: null },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/organic-score-stats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireAdminAuth.mockReturnValue(null);
    mockBadgeFindMany.mockResolvedValue(rows);
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

  it("computes avgScore as mean of non-null scores", async () => {
    const json = await (await GET(makeReq())).json();
    expect(json.avgScore).toBe(Math.round((85 + 45) / 2)); // 65
  });

  it("returns 500 when DB throws", async () => {
    mockBadgeFindMany.mockRejectedValue(new Error("DB down"));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});
