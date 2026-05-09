// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBadgeFindUnique = vi.fn();
const mockBadgeUpdate = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args),
      update: (...args: unknown[]) => mockBadgeUpdate(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

vi.mock("@/lib/organic-score", () => ({
  computeOrganicScore: () => ({ score: 85, tier: "A" }),
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

import { POST } from "@/app/api/organic-score/[owner]/[repo]/refresh/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/organic-score/${owner}/${repo}/refresh`, { method: "POST" }),
  { params: Promise.resolve({ owner, repo }) },
];

const ghRepoData = {
  forks_count: 1500,
  subscribers_count: 300,
  stargazers_count: 50000,
  open_issues_count: 120,
};

const makeFetchOk = (json: unknown, headers?: Record<string, string | null>) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(json),
  headers: {
    get: (key: string) => headers?.[key] ?? null,
  },
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/organic-score/[owner]/[repo]/refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_ORGANIC_SCORE_ENABLED", "true");

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mockBadgeFindUnique.mockResolvedValue({
      totalCount: 50000,
      organicComputedAt: twoDaysAgo,
    });
    mockBadgeUpdate.mockResolvedValue({});
    mockQueryRaw.mockResolvedValue([{ zero_count: 500n, sample_size: 5000n }]);

    // 4 parallel fetch calls: repo, releases/latest, search/issues, releases list
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeFetchOk(ghRepoData))
      .mockResolvedValueOnce(makeFetchOk({ tag_name: "v18.2.0", html_url: "https://github.com", published_at: "2025-12-01T00:00:00Z" }))
      .mockResolvedValueOnce(makeFetchOk({ total_count: 5 }))
      .mockResolvedValueOnce(makeFetchOk([{ id: 1 }])), // releases count — no link header
    );
  });

  // ── Feature flag ─────────────────────────────────────────────────────────

  describe("feature flag", () => {
    it("returns 404 when NEXT_PUBLIC_ORGANIC_SCORE_ENABLED is not 'true'", async () => {
      vi.stubEnv("NEXT_PUBLIC_ORGANIC_SCORE_ENABLED", "false");
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Not found / rate limit ─────────────────────────────────────────────────

  describe("preconditions", () => {
    it("returns 404 when badge_cache row does not exist", async () => {
      mockBadgeFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 429 when organicComputedAt is within cooldown", async () => {
      mockBadgeFindUnique.mockResolvedValue({
        totalCount: 50000,
        organicComputedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      });
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(429);
    });
  });

  // ── GitHub errors ─────────────────────────────────────────────────────────

  describe("GitHub errors", () => {
    it("returns 502 when GitHub repo request fails", async () => {
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
        .mockResolvedValueOnce(makeFetchOk(null) as unknown as Response)
        .mockResolvedValueOnce(makeFetchOk({ total_count: 0 }) as unknown as Response)
        .mockResolvedValueOnce(makeFetchOk([]) as unknown as Response);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(502);
    });
  });

  // ── Success ───────────────────────────────────────────────────────────────

  describe("success", () => {
    it("returns 200 with organic object containing score and tier", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(typeof json.organic.score).toBe("number");
      expect(json.organic.tier).toBe("A");
    });

    it("returns forksCount and totalCount from GitHub", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await POST(req, ctx)).json();
      expect(json.organic.forksCount).toBe(1500);
      expect(json.organic.totalCount).toBe(50000);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws on badge lookup", async () => {
      mockBadgeFindUnique.mockRejectedValue(new Error("DB down"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await POST(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
