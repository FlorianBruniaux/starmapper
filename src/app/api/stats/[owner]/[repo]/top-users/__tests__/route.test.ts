// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (owner: string, repo: string) => ({
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
  }),
}));

import { GET } from "@/app/api/stats/[owner]/[repo]/top-users/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}/top-users`),
  { params: Promise.resolve({ owner, repo }) },
];

const userRow = {
  login: "torvalds",
  name: "Linus Torvalds",
  followers: 200000,
  publicRepos: 10,
  location: "Portland, OR",
  company: "Linux Foundation",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/stats/[owner]/[repo]/top-users", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([userRow]);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid repo", async () => {
      const [req, ctx] = makeReq("facebook", "bad repo!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with topUsers array", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.topUsers)).toBe(true);
    });

    it("adds avatarUrl from login", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      expect(json.topUsers[0].avatarUrl).toBe("https://github.com/torvalds.png");
    });

    it("includes standard user fields", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      const user = json.topUsers[0];
      expect(user.login).toBe("torvalds");
      expect(typeof user.followers).toBe("number");
    });

    it("returns Cache-Control with private", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("private");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockRejectedValue(new Error("timeout"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
