// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    stargazerCache: { findUnique: vi.fn() },
    badgeCache: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/api-validation", () => ({
  validateOwnerRepo: (owner: string, repo: string) =>
    /^[a-zA-Z0-9_.-]+$/.test(owner) && /^[a-zA-Z0-9_.-]+$/.test(repo)
      ? { owner: owner.toLowerCase(), repo: repo.toLowerCase() }
      : null,
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: vi.fn(),
}));

const makeRequest = (owner = "vercel", repo = "next.js") =>
  new NextRequest(`http://localhost/api/mcp/points/${owner}/${repo}`);

const makeParams = (owner = "vercel", repo = "next.js") =>
  ({ params: Promise.resolve({ owner, repo }) });

const STORED_POINTS = [
  { login: "alice", lat: 48.8566, lng: 2.3522, avatarUrl: "https://github.com/alice.png" },
  { login: "bob",   lat: 51.5074, lng: -0.1278 },
  { login: "carol", lat: 40.7128, lng: -74.0060 },
];

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/mcp/points/[owner]/[repo]", () => {
  test("returns 400 on invalid owner", async () => {
    const res = await GET(makeRequest("bad owner!", "repo"), makeParams("bad owner!", "repo"));
    expect(res.status).toBe(400);
  });

  test("returns 404 when neither stargazer cache nor badge cache exist", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("returns 206 when stargazer cache is absent but badge cache exists", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue({
      updatedAt: new Date("2026-01-15T10:00:00Z"),
    } as never);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(206);
    const body = await res.json();
    expect(body.lastScan).toBe("2026-01-15T10:00:00.000Z");
  });

  test("returns decompressed points with precision reduced to 2 decimals", async () => {
    const { prisma } = await import("@/lib/db");
    const { decompressGzBase64 } = await import("@/lib/compression");

    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue({
      points: "fakegzb64",
      totalCount: 3,
      scannedAt: new Date("2026-06-01T12:00:00Z"),
    } as never);
    vi.mocked(decompressGzBase64).mockReturnValue(STORED_POINTS as never);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalCount).toBe(3);
    expect(body.scannedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(body.points).toHaveLength(3);
    expect(body.points[0]).toEqual({ login: "alice", lat: 48.86, lng: 2.35 });
    expect(body.points[1]).toEqual({ login: "bob",   lat: 51.51, lng: -0.13 });
    expect(body.points[2]).toEqual({ login: "carol", lat: 40.71, lng: -74.01 });
  });

  test("strips extra fields (avatarUrl, followers) from stored points", async () => {
    const { prisma } = await import("@/lib/db");
    const { decompressGzBase64 } = await import("@/lib/compression");

    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue({
      points: "fakegzb64",
      totalCount: 1,
      scannedAt: new Date("2026-06-01T00:00:00Z"),
    } as never);
    vi.mocked(decompressGzBase64).mockReturnValue([
      { login: "alice", lat: 48.8566, lng: 2.3522, avatarUrl: "https://github.com/alice.png", followers: 1234 },
    ] as never);

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();
    expect(Object.keys(body.points[0])).toEqual(["login", "lat", "lng"]);
  });

  test("caps output at 10k via stride sampling when cache has more", async () => {
    const { prisma } = await import("@/lib/db");
    const { decompressGzBase64 } = await import("@/lib/compression");

    const bigArray = Array.from({ length: 20_000 }, (_, i) => ({
      login: `user${i}`,
      lat: i * 0.001,
      lng: i * 0.001,
    }));
    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue({
      points: "fakegzb64",
      totalCount: 20_000,
      scannedAt: new Date("2026-06-01T00:00:00Z"),
    } as never);
    vi.mocked(decompressGzBase64).mockReturnValue(bigArray as never);

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();
    expect(body.points).toHaveLength(10_000);
    // totalCount reflects the true repo total, not the capped point count
    expect(body.totalCount).toBe(20_000);
  });

  test("returns all points when count is at or below cap", async () => {
    const { prisma } = await import("@/lib/db");
    const { decompressGzBase64 } = await import("@/lib/compression");

    const smallArray = Array.from({ length: 500 }, (_, i) => ({
      login: `user${i}`,
      lat: i * 0.1,
      lng: i * 0.1,
    }));
    vi.mocked(prisma.stargazerCache.findUnique).mockResolvedValue({
      points: "fakegzb64",
      totalCount: 500,
      scannedAt: new Date("2026-06-01T00:00:00Z"),
    } as never);
    vi.mocked(decompressGzBase64).mockReturnValue(smallArray as never);

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();
    expect(body.points).toHaveLength(500);
  });

  test("returns 500 when DB throws", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.stargazerCache.findUnique).mockRejectedValue(new Error("connection refused"));

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(500);
  });
});
