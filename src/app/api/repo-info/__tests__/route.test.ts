// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/repo-info/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (owner: string | null, repo: string | null, ghToken?: string): NextRequest => {
  const url = new URL("http://localhost/api/repo-info");
  if (owner !== null) url.searchParams.set("owner", owner);
  if (repo !== null) url.searchParams.set("repo", repo);
  const headers: Record<string, string> = {};
  if (ghToken) headers["x-gh-token"] = ghToken;
  return new NextRequest(url.toString(), { headers });
};

const GITHUB_PAYLOAD = {
  full_name: "octocat/hello-world",
  description: "My first repo",
  stargazers_count: 1234,
  language: "TypeScript",
  owner: { avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
  forks_count: 50,
  subscribers_count: 10,
};

const mockFetchOk = (body: unknown = GITHUB_PAYLOAD) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const mockFetchStatus = (status: number) =>
  new Response(JSON.stringify({ message: "error" }), { status });

/**
 * Simulates the GitHub /contributors?per_page=1 response with a Link header
 * indicating N total contributors (using pagination last page = N).
 */
const mockContributorsOk = (total: number) =>
  new Response(JSON.stringify([{ login: "user1", contributions: 42 }]), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      Link: `<https://api.github.com/repos/x/y/contributors?per_page=1&page=2>; rel="next", <https://api.github.com/repos/x/y/contributors?per_page=1&page=${total}>; rel="last"`,
    },
  });

/** Small repo — no Link header because all contributors fit on one page. */
const mockContributorsSmall = (count: number) =>
  new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({ login: `user${i}` }))), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Creates a fetch mock that dispatches by URL:
 *   - /contributors → contribResponse (default: 42 contributors)
 *   - anything else → repoResponse (default: GITHUB_PAYLOAD 200)
 *
 * This avoids ordering issues with mockResolvedValueOnce queues when
 * individual tests override the mock for error status codes.
 */
const makeFetchMock = (
  repoResponse: Response = mockFetchOk(),
  contribResponse: Response = mockContributorsOk(42),
) =>
  vi.fn().mockImplementation((url: string) => {
    if (url.includes("/contributors")) return Promise.resolve(contribResponse);
    return Promise.resolve(repoResponse);
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/repo-info", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetchMock());
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when owner is missing", async () => {
      const res = await GET(makeReq(null, "hello-world"));
      expect(res.status).toBe(400);
    });

    it("returns 400 when repo is missing", async () => {
      const res = await GET(makeReq("octocat", null));
      expect(res.status).toBe(400);
    });

    it("returns 400 when owner contains invalid chars (space)", async () => {
      const res = await GET(makeReq("bad owner", "repo"));
      expect(res.status).toBe(400);
    });
  });

  // ── GitHub status code mapping ─────────────────────────────────────────────

  describe("GitHub status code mapping", () => {
    it("returns 404 when GitHub returns 404", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchStatus(404)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(404);
    });

    it("returns 429 when GitHub returns 403 (rate limited)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchStatus(403)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(429);
    });

    it("returns 429 when GitHub returns 429", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchStatus(429)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(429);
    });

    it("returns 401 when GitHub returns 401 (bad token)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchStatus(401)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(401);
    });

    it("returns 502 for unexpected GitHub error status", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchStatus(500)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(502);
    });

    it("returns 502 when fetch throws (network error)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(502);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with repo metadata fields", async () => {
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("octocat/hello-world");
      expect(json.stars).toBe(1234);
      expect(json.language).toBe("TypeScript");
      expect(json.forksCount).toBe(50);
      expect(json.watchersCount).toBe(10);
      expect(json.avatar).toContain("avatars.githubusercontent.com");
    });

    it("includes Cache-Control header for CDN caching", async () => {
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── contributors count ─────────────────────────────────────────────────────

  describe("contributorsCount", () => {
    it("returns contributorsCount from Link header last page", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchOk(), mockContributorsOk(127)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.contributorsCount).toBe(127);
    });

    it("returns contributorsCount = array length when no Link header (small repo)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchOk(), mockContributorsSmall(7)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.contributorsCount).toBe(7);
    });

    it("returns contributorsCount = null when contributors fetch fails (network error)", async () => {
      // Contributors fetch rejects — repo-info must still respond with 200.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (url.includes("/contributors")) return Promise.reject(new Error("timeout"));
          return Promise.resolve(mockFetchOk());
        }),
      );
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.contributorsCount).toBeNull();
    });

    it("returns contributorsCount = null when GitHub returns 202 (stats computing)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchOk(), mockFetchStatus(202)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.contributorsCount).toBeNull();
    });

    it("returns contributorsCount = null when GitHub returns 403 on contributors endpoint", async () => {
      vi.stubGlobal("fetch", makeFetchMock(mockFetchOk(), mockFetchStatus(403)));
      const res = await GET(makeReq("octocat", "hello-world"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.contributorsCount).toBeNull();
    });
  });
});
