// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBadgeFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: { findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args) },
  },
}));

import { GET } from "@/app/api/badge/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/badge/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/badge/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBadgeFindUnique.mockResolvedValue(null);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for owner containing spaces", async () => {
      const [req, ctx] = makeReq("bad owner", "repo");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Response format ────────────────────────────────────────────────────────

  describe("response format", () => {
    it("returns Content-Type image/svg+xml", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
    });

    it("returns 200 status", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });

    it("returns valid SVG element", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const svg = await (await GET(req, ctx)).text();
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    });

    it("includes 'StarMapper' as the label", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const svg = await (await GET(req, ctx)).text();
      expect(svg).toContain("StarMapper");
    });

    it("shows fallback text 'map your stargazers' when no badge data", async () => {
      mockBadgeFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq("octocat", "hello-world");
      const svg = await (await GET(req, ctx)).text();
      expect(svg).toContain("map your stargazers");
    });

    it("shows mapped count and country count when badge data exists", async () => {
      mockBadgeFindUnique.mockResolvedValue({ mappedCount: 500, countryCount: 30 });
      const [req, ctx] = makeReq("octocat", "hello-world");
      const svg = await (await GET(req, ctx)).text();
      expect(svg).toContain("countries");
      expect(svg).toContain("mapped");
    });

    it("includes Cache-Control header for CDN caching", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=21600");
    });
  });

  // ── Resilience ────────────────────────────────────────────────────────────

  describe("resilience", () => {
    it("returns fallback SVG even when DB throws", async () => {
      mockBadgeFindUnique.mockRejectedValue(new Error("DB down"));
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
    });
  });
});
