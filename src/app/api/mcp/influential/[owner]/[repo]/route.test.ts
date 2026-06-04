// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
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

const makeRequest = (owner = "vercel", repo = "next.js", minFollowers = "500") =>
  new NextRequest(
    `http://localhost/api/mcp/influential/${owner}/${repo}?minFollowers=${minFollowers}`
  );

const makeParams = (owner = "vercel", repo = "next.js") =>
  ({ params: Promise.resolve({ owner, repo }) });

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/mcp/influential/[owner]/[repo]", () => {
  test("returns 400 on invalid owner", async () => {
    const res = await GET(makeRequest("bad owner!", "repo"), makeParams("bad owner!", "repo"));
    expect(res.status).toBe(400);
  });

  test("returns 400 when minFollowers is not a valid integer", async () => {
    const res = await GET(makeRequest("vercel", "next.js", "notanumber"), makeParams());
    expect(res.status).toBe(400);
  });

  test("returns 400 when minFollowers is negative", async () => {
    const res = await GET(makeRequest("vercel", "next.js", "-1"), makeParams());
    expect(res.status).toBe(400);
  });

  test("returns empty array when no users above threshold", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.minFollowers).toBe(500);
  });

  test("returns users sorted by followers desc with profile URL", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { login: "tj", name: "TJ Holowaychuk", followers: 42000, location: "Victoria, BC", company: null },
      { login: "addyosmani", name: "Addy Osmani", followers: 35000, location: "San Francisco, CA", company: "Google" },
    ]);

    const res = await GET(makeRequest("vercel", "next.js", "1000"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.users).toHaveLength(2);
    expect(body.users[0]).toEqual({
      login: "tj",
      name: "TJ Holowaychuk",
      followers: 42000,
      location: "Victoria, BC",
      profileUrl: "https://github.com/tj",
      avatarUrl: "https://github.com/tj.png",
    });
    expect(body.total).toBe(2);
    expect(body.minFollowers).toBe(1000);
  });

  test("defaults minFollowers to 500 when param is absent", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/mcp/influential/vercel/next.js");
    const res = await GET(req, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.minFollowers).toBe(500);
  });

  test("returns 500 when DB throws", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection refused"));
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(500);
  });
});
