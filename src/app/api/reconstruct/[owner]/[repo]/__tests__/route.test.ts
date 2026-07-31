// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

import { GET } from "@/app/api/reconstruct/[owner]/[repo]/route";

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/reconstruct/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const ROWS = [
  { login: "a", name: null, company: null, location: "Paris", followers: 10, lat: 48.8566, lng: 2.3522, linkedinUrl: "https://linkedin.com/in/a", starredAt: new Date("2024-01-01") },
  { login: "b", name: null, company: null, location: null, followers: 3, lat: null, lng: null, linkedinUrl: null, starredAt: new Date("2024-01-02") },
];

describe("GET /api/reconstruct/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([]);
  });

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "repo");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when star_event has no rows for this repo", async () => {
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("splits rows into mapped points and unmapped by lat/lng presence", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points).toHaveLength(1);
    expect(json.points[0].login).toBe("a");
    expect(json.unmapped).toHaveLength(1);
    expect(json.unmapped[0].login).toBe("b");
    expect(json.totalCount).toBe(2);
  });

  it("rounds lat/lng to 2 decimals", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].lat).toBe(48.86);
    expect(json.points[0].lng).toBe(2.35);
  });

  it("derives avatarUrl from login", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].avatarUrl).toBe("https://github.com/a.png");
  });

  it("passes linkedinUrl through instead of hardcoding null", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].linkedinUrl).toBe("https://linkedin.com/in/a");
  });

  it("caps the query with a LIMIT so the star_event join stays bounded", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    await GET(req, ctx);
    const [strings, ...values] = mockQueryRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(strings.join("?")).toContain("LIMIT");
    expect(values).toContain(10_000);
  });

  it("returns 503, not 500, when Neon times out the query (P2010)", async () => {
    mockQueryRaw.mockRejectedValue(Object.assign(new Error("statement timeout"), { code: "P2010" }));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("timeout");
  });

  it("returns 503 when the connection pool is exhausted (P2024)", async () => {
    mockQueryRaw.mockRejectedValue(Object.assign(new Error("pool timeout"), { code: "P2024" }));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(503);
  });

  it("returns 500 when the query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB error"));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
