// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockUserCreate = vi.fn();
const mockUserUpdate = vi.fn();
const mockGeocode = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      create: (...args: unknown[]) => mockUserCreate(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

vi.mock("@/lib/geocoder", () => ({
  geocode: (...args: unknown[]) => mockGeocode(...args),
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  extractGhToken: () => undefined, // no PAT in tests
  logError: vi.fn(),
}));

vi.mock("@/lib/api-validation", () => ({
  LOGIN_RE: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
}));

import { POST } from "@/app/api/profile/[login]/refresh/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  login: string,
): [NextRequest, { params: Promise<{ login: string }> }] => [
  new NextRequest(`http://localhost/api/profile/${login}/refresh`, { method: "POST" }),
  { params: Promise.resolve({ login }) },
];

const ghUserPayload = {
  name: "The Octocat",
  company: "@github",
  location: null,
  followers: 5000,
  following: 100,
  public_repos: 50,
};

const mockFetchOk = (payload = ghUserPayload) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(payload),
});

const mockFetch404 = () => ({
  ok: false,
  status: 404,
  json: () => Promise.resolve({}),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/profile/[login]/refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: user exists, past cooldown
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockUserFindUnique.mockResolvedValue({ login: "octocat" });
    mockUserFindFirst.mockResolvedValue({
      login: "octocat", location: null, fetchedAt: twoHoursAgo, lat: null, lng: null,
    });
    mockUserUpdate.mockResolvedValue({});
    mockUserCreate.mockResolvedValue({});
    mockGeocode.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchOk()));
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for login with spaces", async () => {
      const [req, ctx] = makeReq("bad login");
      const res = await POST(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Cooldown ──────────────────────────────────────────────────────────────

  describe("cooldown", () => {
    it("returns 429 with retryAfterSec when user was refreshed less than 1h ago", async () => {
      const recentFetch = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      mockUserFindFirst.mockResolvedValue({
        login: "octocat", location: null, fetchedAt: recentFetch, lat: null, lng: null,
      });
      const [req, ctx] = makeReq("octocat");
      const res = await POST(req, ctx);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(typeof json.retryAfterSec).toBe("number");
      expect(json.retryAfterSec).toBeGreaterThan(0);
    });
  });

  // ── User exists — update ──────────────────────────────────────────────────

  describe("existing user refresh", () => {
    it("returns 200 with ok=true and updatedAt", async () => {
      const [req, ctx] = makeReq("octocat");
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(typeof json.updatedAt).toBe("string");
    });

    it("returns 404 when GitHub REST returns 404 for an existing DB user", async () => {
      vi.mocked(fetch).mockResolvedValue(mockFetch404() as unknown as Response);
      const [req, ctx] = makeReq("octocat");
      const res = await POST(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── User not in DB — create on the fly ───────────────────────────────────

  describe("user not in DB", () => {
    beforeEach(() => {
      mockUserFindUnique.mockResolvedValue(null);
      mockUserFindFirst.mockResolvedValue(null);
    });

    it("creates user and returns 200 when GitHub finds the user", async () => {
      const [req, ctx] = makeReq("newuser");
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 404 when GitHub does not know the user", async () => {
      vi.mocked(fetch).mockResolvedValue(mockFetch404() as unknown as Response);
      const [req, ctx] = makeReq("ghost");
      const res = await POST(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockUserFindUnique.mockRejectedValue(new Error("connection lost"));
      const [req, ctx] = makeReq("octocat");
      const res = await POST(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
