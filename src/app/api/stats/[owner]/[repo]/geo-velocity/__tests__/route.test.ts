// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

vi.mock("@/lib/api-validation", () => ({
  validateOwnerRepo: (owner: string, repo: string) => {
    const re = /^[a-zA-Z0-9._-]{1,100}$/;
    if (!re.test(owner) || !re.test(repo)) return null;
    if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
    return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
  },
}));

import { GET } from "@/app/api/stats/[owner]/[repo]/geo-velocity/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}/geo-velocity`),
  { params: Promise.resolve({ owner, repo }) },
];

// Returns a row with bigint values matching the raw SQL output shape
const makeRow = (country: string, s30: number, s90: number, total: number) => ({
  country,
  stars_30d: BigInt(s30),
  stars_90d: BigInt(s90),
  total: BigInt(total),
});

describe("GET /api/stats/[owner]/[repo]/geo-velocity", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Input validation ─────────────────────────────────────────────────────

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  // ── Trend classification ─────────────────────────────────────────────────
  // Trend logic: rate30 = s30/30, historical60 = s90-s30, rate60 = historical60/60
  //   rate60=0 → "new" (s30>0) or "stable" (s30=0)
  //   ratio = rate30/rate60: ≥1.5→rising, ≤0.5→declining, else→stable

  describe("trend classification", () => {
    it("classifies 'rising' when ratio >= 1.5", async () => {
      // rate30=90/30=3, historical60=150-90=60, rate60=60/60=1, ratio=3 → rising
      mockQueryRaw.mockResolvedValue([makeRow("France", 90, 150, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const json = await (await GET(req, ctx)).json();
      expect(json.items[0].trend).toBe("rising");
    });

    it("classifies 'new' when no 31-90d history but has 30d stars", async () => {
      // stars_90d === stars_30d → historical60=0 → rate60=0 → "new" (s30>0)
      mockQueryRaw.mockResolvedValue([makeRow("Germany", 10, 10, 10)]);
      const [req, ctx] = makeReq("owner", "repo");
      const json = await (await GET(req, ctx)).json();
      expect(json.items[0].trend).toBe("new");
    });

    it("classifies 'declining' when ratio <= 0.5", async () => {
      // rate30=10/30=0.33, historical60=120-10=110, rate60=110/60=1.83, ratio≈0.2 → declining
      mockQueryRaw.mockResolvedValue([makeRow("USA", 10, 120, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const json = await (await GET(req, ctx)).json();
      expect(json.items[0].trend).toBe("declining");
    });

    it("classifies 'stable' when ratio is between 0.5 and 1.5", async () => {
      // rate30=30/30=1, historical60=90-30=60, rate60=60/60=1, ratio=1.0 → stable
      mockQueryRaw.mockResolvedValue([makeRow("UK", 30, 90, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const json = await (await GET(req, ctx)).json();
      expect(json.items[0].trend).toBe("stable");
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns 200 with items array and public Cache-Control", async () => {
    mockQueryRaw.mockResolvedValue([makeRow("France", 10, 20, 30)]);
    const [req, ctx] = makeReq("facebook", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const json = await res.json();
    expect(Array.isArray(json.items)).toBe(true);
  });

  it("returns empty items array when no rows", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const [req, ctx] = makeReq("facebook", "react");
    const json = await (await GET(req, ctx)).json();
    expect(json.items).toHaveLength(0);
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("returns 500 when DB throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("timeout"));
    const [req, ctx] = makeReq("facebook", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
