// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  },
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/api-validation", () => ({
  LOGIN_RE: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
}));

import { GET } from "@/app/api/explore/user-repos/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (login: string): NextRequest =>
  new NextRequest(`http://localhost/api/explore/user-repos?login=${encodeURIComponent(login)}`);

const cachedRepo = {
  name: "react",
  fullName: "octocat/react",
  description: "A JS library",
  stars: 200000,
  language: "JavaScript",
  url: "https://github.com/octocat/react",
};

const rawGhRepo = {
  name: "react",
  full_name: "octocat/react",
  description: "A JS library",
  stargazers_count: 200000,
  language: "JavaScript",
  html_url: "https://github.com/octocat/react",
  fork: false,
};

const makeFetchOk = (json: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(json),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/user-repos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUserFindUnique.mockResolvedValue(null);
    mockUserUpdate.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeFetchOk({ public_repos: 50 })) // user
      .mockResolvedValueOnce(makeFetchOk([rawGhRepo])),          // repos
    );
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for missing login", async () => {
      const req = new NextRequest("http://localhost/api/explore/user-repos");
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid login (spaces)", async () => {
      const res = await GET(makeReq("bad login"));
      expect(res.status).toBe(400);
    });
  });

  // ── Fresh DB cache ────────────────────────────────────────────────────────

  describe("DB cache hit", () => {
    it("returns cached repos without calling GitHub when fresh", async () => {
      const recentFetch = new Date(Date.now() - 60 * 60 * 1000); // 1h ago — fresh
      mockUserFindUnique.mockResolvedValue({
        topRepos: [cachedRepo],
        topReposFetchedAt: recentFetch,
        publicRepos: 50,
      });
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.repos[0].name).toBe("react");
      // fetch should not be called
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  // ── GitHub fetch ──────────────────────────────────────────────────────────

  describe("GitHub fetch", () => {
    it("returns 200 with repos from GitHub when DB has no cache", async () => {
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.repos)).toBe(true);
      expect(json.repos[0].name).toBe("react");
    });

    it("filters out forks", async () => {
      const forkRepo = { ...rawGhRepo, fork: true, name: "forked-repo" };
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeFetchOk({ public_repos: 50 }) as unknown as Response)
        .mockResolvedValueOnce(makeFetchOk([rawGhRepo, forkRepo]) as unknown as Response);
      const json = await (await GET(makeReq("octocat"))).json();
      const names = json.repos.map((r: { name: string }) => r.name);
      expect(names).not.toContain("forked-repo");
    });

    it("returns 404 when GitHub responds with 404", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response)
        .mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);
      const res = await GET(makeReq("ghost-user"));
      expect(res.status).toBe(404);
    });

    it("includes Cache-Control s-maxage=300", async () => {
      const res = await GET(makeReq("octocat"));
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when fetch throws", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockRejectedValue(new Error("network error"));
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(500);
    });
  });
});
