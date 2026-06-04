// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9_.-]+$/,
  normalizeOwnerRepo: (owner: string, repo: string) => ({ owner: owner.toLowerCase(), repo: repo.toLowerCase() }),
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

const makeBadgeRow = (overrides = {}) => ({
  organicScore: 72,
  organicTier: "healthy",
  organicComputedAt: new Date("2026-06-01T00:00:00Z"),
  forksCount: 800,
  watchersCount: 150,
  totalCount: 8000,
  releasesCount: 25,
  ...overrides,
});

const makeRequest = (owner = "anthropic", repo = "claude") =>
  new NextRequest(`http://localhost/api/mcp/organic-score/${owner}/${repo}`);

const makeParams = (owner = "anthropic", repo = "claude") =>
  ({ params: Promise.resolve({ owner, repo }) });

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/mcp/organic-score/[owner]/[repo]", () => {
  test("returns 400 on invalid owner", async () => {
    const res = await GET(makeRequest("bad owner!", "repo"), makeParams("bad owner!", "repo"));
    expect(res.status).toBe(400);
  });

  test("returns 404 when badge_cache not found", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("returns 404 when organicTier is null", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(
      makeBadgeRow({ organicTier: null }) as any
    );
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("returns full signal breakdown with forkRatio and watcherRatio computed", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ zero_count: BigInt(320), sample_size: BigInt(1600) }]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.score).toBe(72);
    expect(body.tier).toBe("healthy");
    expect(body.tierLabel).toBe("Healthy");
    expect(body.corpusAccuracy).toBe(85.7);
    expect(body.signals.forkRatio).toBeCloseTo(0.1);      // 800 / 8000
    expect(body.signals.watcherRatio).toBeCloseTo(0.01875); // 150 / 8000
    expect(body.signals.zeroFollowerPct).toBeCloseTo(20);  // 320 / 1600 * 100
    expect(body.signals.sampleSize).toBe(1600);
    expect(body.weights).toEqual({ fork_ratio: 30, watcher_ratio: 5, zero_follower_pct: 45, releases_count: 20 });
    expect(Array.isArray(body.activeSignals)).toBe(true);
  });

  test("returns zeroFollowerPct null when zf query returns no rows", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.zeroFollowerPct).toBeNull();
    expect(body.signals.sampleSize).toBe(0);
  });

  test("returns zeroFollowerPct null when zf query throws (Neon timeout)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("canceling statement due to statement timeout"));

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.zeroFollowerPct).toBeNull();
  });
});
