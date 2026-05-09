// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockBadgeFindMany = vi.fn();
const mockStarFindMany = vi.fn();
const mockStarCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
    },
    badgeCache: { findMany: (...args: unknown[]) => mockBadgeFindMany(...args) },
    starEvent: {
      findMany: (...args: unknown[]) => mockStarFindMany(...args),
      count: (...args: unknown[]) => mockStarCount(...args),
    },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

import { GET } from "@/app/api/profile/[login]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  login: string,
): [NextRequest, { params: Promise<{ login: string }> }] => [
  new NextRequest(`http://localhost/api/profile/${login}`),
  { params: Promise.resolve({ login }) },
];

const fullUser = {
  login: "octocat",
  name: "The Octocat",
  company: "@github",
  location: "San Francisco, CA",
  followers: 5000,
  publicRepos: 50,
  lat: 37.77,
  lng: -122.41,
  countryNormalized: "United States",
  cityNormalized: "San Francisco",
  languages: ["JavaScript", "Ruby"],
  linkedinUrl: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/profile/[login]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUserFindUnique.mockResolvedValue({ login: "octocat" }); // exact match exists
    mockUserFindFirst.mockResolvedValue(fullUser);
    mockBadgeFindMany.mockResolvedValue([]);
    mockStarFindMany.mockResolvedValue([]);
    mockStarCount.mockResolvedValue(0);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for login with spaces", async () => {
      const [req, ctx] = makeReq("bad login");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for login with special chars", async () => {
      const [req, ctx] = makeReq("bad@login!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── 404 ────────────────────────────────────────────────────────────────────

  describe("not found", () => {
    it("returns 404 when user is not in DB and has no badge_cache repos", async () => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserFindFirst.mockResolvedValue(null);
      mockBadgeFindMany.mockResolvedValue([]);
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Partial profile ────────────────────────────────────────────────────────

  describe("partial profile", () => {
    it("returns 200 partial=true when user is not in DB but has badge_cache repos", async () => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserFindFirst.mockResolvedValue(null);
      mockBadgeFindMany.mockResolvedValue([
        { owner: "octocat", repo: "hello-world", totalCount: 100, mappedCount: 80, language: "JavaScript" },
      ]);
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(json.partial).toBe(true);
      expect(Array.isArray(json.ownedRepos)).toBe(true);
      expect(json.ownedRepos.length).toBeGreaterThan(0);
    });
  });

  // ── Full profile ──────────────────────────────────────────────────────────

  describe("full profile", () => {
    it("returns 200 with complete profile fields", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.login).toBe("octocat");
      expect(json.partial).toBe(false);
      expect(typeof json.followers).toBe("number");
      expect(Array.isArray(json.languages)).toBe(true);
      expect(Array.isArray(json.ownedRepos)).toBe(true);
      expect(Array.isArray(json.starredRepos)).toBe(true);
    });

    it("includes starredAt=null for owned repos", async () => {
      mockBadgeFindMany.mockResolvedValue([
        { owner: "octocat", repo: "hello-world", totalCount: 100, mappedCount: 80, language: null },
      ]);
      const [req, ctx] = makeReq("octocat");
      const json = await (await GET(req, ctx)).json();
      expect(json.ownedRepos[0].starredAt).toBeNull();
    });

    it("includes Cache-Control with s-maxage=300", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockUserFindUnique.mockRejectedValue(new Error("connection lost"));
      const [req, ctx] = makeReq("octocat");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
