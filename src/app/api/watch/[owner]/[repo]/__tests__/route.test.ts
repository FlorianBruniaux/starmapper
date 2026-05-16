// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (o: string, r: string) => ({ owner: o.toLowerCase(), repo: r.toLowerCase() }),
}));

import { GET } from "@/app/api/watch/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
  since?: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => {
  const url = since
    ? `http://localhost/api/watch/${owner}/${repo}?since=${encodeURIComponent(since)}`
    : `http://localhost/api/watch/${owner}/${repo}`;
  return [new NextRequest(url), { params: Promise.resolve({ owner, repo }) }];
};

// A timestamp from 1 minute ago — stars after this are "new"
const SINCE = new Date(Date.now() - 60_000).toISOString();

const makeGhStar = (login: string, ts = new Date().toISOString()) => ({
  starred_at: ts,
  user: { login },
});

const makeJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("GET /api/watch/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_TOKEN", "test_token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ── Input validation ─────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid since date", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world", "not-a-date");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 503 when GITHUB_TOKEN is not set", async () => {
      vi.stubEnv("GITHUB_TOKEN", "");
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(503);
    });
  });

  // ── GitHub error responses ───────────────────────────────────────────────

  describe("GitHub error responses", () => {
    it("returns 404 when GitHub returns 404", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 429 when GitHub returns 403 (rate limit)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 403 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(429);
    });

    it("returns 502 when GitHub returns 500", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(502);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns { newCount:0, countries:[], logins:[] } when no new stars", async () => {
      const oldStar = makeGhStar("user1", new Date(Date.now() - 60 * 60_000).toISOString());
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([oldStar]));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ newCount: 0, countries: [], logins: [] });
    });

    it("returns logins and countries for new stars", async () => {
      const newStar = makeGhStar("alice");
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([newStar]));
      mockFindMany.mockResolvedValue([{ countryNormalized: "France" }]);

      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const json = await (await GET(req, ctx)).json();
      expect(json.newCount).toBe(1);
      expect(json.logins).toContain("alice");
      expect(json.countries).toContain("France");
    });

    it("deduplicates countries", async () => {
      const stars = [makeGhStar("alice"), makeGhStar("bob")];
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse(stars));
      mockFindMany.mockResolvedValue([
        { countryNormalized: "France" },
        { countryNormalized: "France" },
      ]);

      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const json = await (await GET(req, ctx)).json();
      expect(json.countries).toEqual(["France"]);
    });

    it("sets Cache-Control: no-store", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([]));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("returns 500 when fetch throws", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network error"));
    const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
