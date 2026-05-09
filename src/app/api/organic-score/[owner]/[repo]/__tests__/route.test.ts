// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBadgeFindUnique = vi.fn();
const mockBadgeUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args),
      update: (...args: unknown[]) => mockBadgeUpdate(...args),
    },
  },
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

import { GET } from "@/app/api/organic-score/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/organic-score/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const organicRow = {
  organicScore: 82,
  organicTier: "A",
  organicComputedAt: new Date("2026-01-01T00:00:00Z"),
  forksCount: 1500,
  watchersCount: 200,
  totalCount: 50000,
  openIssuesCount: 120,
  openPRsCount: 25, // already set — avoids fetch call
  latestReleaseTag: "v18.2.0",
  latestReleaseUrl: "https://github.com/facebook/react/releases/tag/v18.2.0",
  latestReleaseAt: new Date("2025-12-01T00:00:00Z"),
  releasesCount: 40,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/organic-score/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBadgeFindUnique.mockResolvedValue(organicRow);
    mockBadgeUpdate.mockResolvedValue({});
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

  // ── Not found ─────────────────────────────────────────────────────────────

  describe("not found", () => {
    it("returns 404 when row does not exist", async () => {
      mockBadgeFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 404 when organicTier is null", async () => {
      mockBadgeFindUnique.mockResolvedValue({ ...organicRow, organicTier: null });
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with organic object", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(typeof json.organic.score).toBe("number");
      expect(json.organic.tier).toBe("A");
      expect(typeof json.organic.totalCount).toBe("number");
    });

    it("serializes computedAt and latestReleaseAt as ISO strings", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const json = await (await GET(req, ctx)).json();
      expect(json.organic.computedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(json.organic.latestReleaseAt).toBe("2025-12-01T00:00:00.000Z");
    });

    it("includes Cache-Control with s-maxage=300", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockBadgeFindUnique.mockRejectedValue(new Error("connection lost"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
