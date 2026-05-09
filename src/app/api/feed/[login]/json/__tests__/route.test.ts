// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNewsFindMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockPageViewUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    news: { findMany: (...args: unknown[]) => mockNewsFindMany(...args) },
    gitHubUser: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    pageView: { upsert: (...args: unknown[]) => mockPageViewUpsert(...args) },
  },
}));

vi.mock("@/lib/github-auth", () => ({
  isValidLogin: (s: string) => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(s),
  normalizeLogin: (s: string) => s.toLowerCase(),
}));

vi.mock("@/lib/feed-builders", () => ({
  buildJsonFeed: () => ({
    version: "https://jsonfeed.org/version/1.1",
    title: "StarMapper",
    items: [],
  }),
}));

import { GET } from "@/app/api/feed/[login]/json/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  login: string,
  headers: Record<string, string> = {},
): [NextRequest, { params: Promise<{ login: string }> }] => [
  new NextRequest(`http://localhost/api/feed/${login}/json`, { headers }),
  { params: Promise.resolve({ login }) },
];

const AUTHOR = { login: "octocat", name: "The Octocat" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/feed/[login]/json", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNewsFindMany.mockResolvedValue([]);
    mockUserFindUnique.mockResolvedValue(AUTHOR);
    mockPageViewUpsert.mockResolvedValue(undefined);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid login", async () => {
      const [req, ctx] = makeReq("bad login!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── 404 when user not in DB ────────────────────────────────────────────────

  describe("user not found", () => {
    it("returns 404 when user is not in github_user table", async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── 304 conditional GET ────────────────────────────────────────────────────

  describe("conditional GET", () => {
    it("returns 304 when If-Modified-Since matches last publish date", async () => {
      const pub = new Date("2026-01-01T12:00:00Z");
      mockNewsFindMany.mockResolvedValue([{ id: 1, body: "hi", url: null, publishedAt: pub }]);
      const [req, ctx] = makeReq("octocat", { "if-modified-since": pub.toUTCString() });
      const res = await GET(req, ctx);
      expect(res.status).toBe(304);
    });

    it("returns 200 when If-Modified-Since is before last publish date", async () => {
      const pub = new Date("2026-01-02T12:00:00Z");
      mockNewsFindMany.mockResolvedValue([{ id: 1, body: "hi", url: null, publishedAt: pub }]);
      const earlier = new Date("2026-01-01T00:00:00Z");
      const [req, ctx] = makeReq("octocat", { "if-modified-since": earlier.toUTCString() });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── Response format ───────────────────────────────────────────────────────

  describe("response format", () => {
    it("returns Content-Type application/feed+json", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/feed+json");
    });

    it("returns valid JSON Feed body", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      const text = await res.text();
      const json = JSON.parse(text);
      expect(json.version).toContain("jsonfeed.org");
    });

    it("includes Cache-Control header with s-maxage=3600", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });

    it("includes Last-Modified header", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.headers.get("last-modified")).toBeTruthy();
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockNewsFindMany.mockRejectedValue(new Error("timeout"));
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
