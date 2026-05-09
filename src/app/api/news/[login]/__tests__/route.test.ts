// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNewsFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    news: { findMany: (...args: unknown[]) => mockNewsFindMany(...args) },
  },
}));

vi.mock("@/lib/github-auth", () => ({
  isValidLogin: (s: string) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(s),
  normalizeLogin: (s: string) => s.toLowerCase(),
}));

import { GET } from "@/app/api/news/[login]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  login: string,
): [NextRequest, { params: Promise<{ login: string }> }] => [
  new NextRequest(`http://localhost/api/news/${login}`),
  { params: Promise.resolve({ login }) },
];

const makeRow = (id: number) => ({
  id,
  authorLogin: "octocat",
  body: `Post ${id}`,
  url: null,
  publishedAt: new Date("2026-01-01T12:00:00Z"),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/news/[login]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNewsFindMany.mockResolvedValue([]);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for login with spaces", async () => {
      const [req, ctx] = makeReq("bad login");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_login");
    });

    it("returns 400 for login starting with dash", async () => {
      const [req, ctx] = makeReq("-badlogin");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with items array and hasMore flag", async () => {
      mockNewsFindMany.mockResolvedValue([makeRow(1)]);
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(typeof json.hasMore).toBe("boolean");
    });

    it("sets hasMore=false when fewer than 20 items returned", async () => {
      mockNewsFindMany.mockResolvedValue([makeRow(1), makeRow(2)]);
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(json.hasMore).toBe(false);
    });

    it("sets hasMore=true when exactly 20 items returned (page boundary)", async () => {
      mockNewsFindMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => makeRow(i + 1)));
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(json.hasMore).toBe(true);
    });

    it("serializes publishedAt as ISO string", async () => {
      mockNewsFindMany.mockResolvedValue([makeRow(1)]);
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(typeof json.items[0].publishedAt).toBe("string");
      expect(json.items[0].publishedAt).toContain("T");
    });

    it("returns empty items array when no posts exist", async () => {
      mockNewsFindMany.mockResolvedValue([]);
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(json.items).toHaveLength(0);
      expect(json.hasMore).toBe(false);
    });

    it("normalizes login to lowercase before DB query", async () => {
      const [req, ctx] = makeReq("OctoCat");
      await GET(req, ctx);
      const call = mockNewsFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.authorLogin).toBe("octocat");
    });

    it("includes Cache-Control header", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("max-age=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockNewsFindMany.mockRejectedValue(new Error("connection refused"));
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
