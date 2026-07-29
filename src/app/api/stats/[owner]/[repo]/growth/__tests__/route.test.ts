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

import { GET } from "@/app/api/stats/[owner]/[repo]/growth/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}/growth`),
  { params: Promise.resolve({ owner, repo }) },
];

const WEEKS = [{ week: "2026-01-05", count: 10 }, { week: "2026-01-12", count: 25 }];
const COUNTS = [{ total: 35n, with_ts: 35n }];

describe("GET /api/stats/[owner]/[repo]/growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw
      .mockResolvedValueOnce(WEEKS)
      .mockResolvedValueOnce(COUNTS);
  });

  // ── Input validation ─────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when owner contains invalid characters", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 when repo contains invalid characters", async () => {
      const [req, ctx] = makeReq("facebook", "bad repo!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns 200 with weeks array and totals", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.weeks).toHaveLength(2);
      expect(json.total).toBe(35);
      expect(json.withTimestamps).toBe(35);
    });

    it("sets public Cache-Control header", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("public");
    });

    it("maps week and count correctly", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.weeks[0]).toEqual({ week: "2026-01-05", count: 10 });
    });
  });

  // ── No data ──────────────────────────────────────────────────────────────

  describe("no data", () => {
    it("returns 404 when total is 0", async () => {
      mockQueryRaw.mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0n, with_ts: 0n }]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockReset().mockRejectedValue(new Error("DB down"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
