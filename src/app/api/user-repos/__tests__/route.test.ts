// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/user-repos/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (username: string | null): NextRequest => {
  const url = new URL("http://localhost/api/user-repos");
  if (username !== null) url.searchParams.set("username", username);
  return new NextRequest(url.toString());
};

const GH_USER = { login: "octocat", name: "The Octocat", avatar_url: "https://avatars.githubusercontent.com/u/583231", public_repos: 8 };
const GH_REPO = { name: "hello-world", stargazers_count: 1234, description: "Hello World", language: "TypeScript", fork: false, pushed_at: "2024-01-01T00:00:00Z" };

const okResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

const statusResponse = (status: number) =>
  new Response(JSON.stringify({ message: "error" }), { status });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/user-repos", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(okResponse(GH_USER))
      .mockResolvedValueOnce(okResponse([GH_REPO])),
    );
  });

  // ── Input validation (HIGH-3 regression) ──────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for missing username", async () => {
      const res = await GET(makeReq(null));
      expect(res.status).toBe(400);
    });

    it("returns 400 for username with spaces (injection guard)", async () => {
      const res = await GET(makeReq("bad user!"));
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty string username", async () => {
      const res = await GET(makeReq(""));
      expect(res.status).toBe(400);
    });

    it("accepts valid GitHub username", async () => {
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(200);
    });

    it("accepts username with hyphens and dots", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(okResponse(GH_USER))
        .mockResolvedValueOnce(okResponse([GH_REPO]));
      const res = await GET(makeReq("my-user.name"));
      expect(res.status).toBe(200);
    });
  });

  // ── GitHub status code mapping ─────────────────────────────────────────────

  describe("GitHub status code mapping", () => {
    it("returns 404 when GitHub user not found", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch)
        .mockResolvedValueOnce(statusResponse(404))
        .mockResolvedValueOnce(okResponse([]));
      const res = await GET(makeReq("ghost-user"));
      expect(res.status).toBe(404);
    });

    it("returns 403 when GitHub returns 403 (rate limited)", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch)
        .mockResolvedValueOnce(statusResponse(403))
        .mockResolvedValueOnce(okResponse([]));
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(403);
    });

    it("returns 500 when fetch throws", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(500);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with user and repos", async () => {
      const res = await GET(makeReq("octocat"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.user).toMatchObject({ login: "octocat" });
      expect(Array.isArray(json.repos)).toBe(true);
      expect(json.repos[0]).toMatchObject({ name: "hello-world", stars: 1234 });
    });

    it("maps GitHub repo fields to UserRepo shape", async () => {
      const res = await GET(makeReq("octocat"));
      const json = await res.json();
      const repo = json.repos[0];
      expect(repo.stars).toBe(1234);
      expect(typeof repo.fork).toBe("boolean");
      expect("pushedAt" in repo).toBe(true);
    });

    it("includes Cache-Control header", async () => {
      const res = await GET(makeReq("octocat"));
      expect(res.headers.get("cache-control")).toContain("s-maxage=120");
    });
  });
});
