// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFind = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    engagedCache: { findUnique: (...args: unknown[]) => mockFind(...args) },
  },
}));

const POINTS = [{ login: "a", lat: 1, lng: 2 }];
const UNMAPPED = [{ login: "b" }];

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: (v: unknown) => {
    if (v === "gz_points") return POINTS;
    if (v === "gz_unmapped") return UNMAPPED;
    return [];
  },
}));

import { GET } from "@/app/api/engaged/[owner]/[repo]/route";

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/engaged/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const SCANNED_AT = new Date("2026-07-26T00:00:00Z");
const ROW = {
  scannedAt: SCANNED_AT,
  pointsGz: "gz_points",
  unmappedGz: "gz_unmapped",
  knownCount: 2,
  starCount: 100,
  channels: "fork,issue,pr,mention,watch",
};

describe("GET /api/engaged/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFind.mockResolvedValue(null);
  });

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "repo");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no engaged_cache row exists", async () => {
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 200 with points, unmapped, knownCount, starCount, channels", async () => {
    mockFind.mockResolvedValue(ROW);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.knownCount).toBe(2);
    expect(json.starCount).toBe(100);
    expect(json.channels).toEqual(["fork", "issue", "pr", "mention", "watch"]);
    expect(Array.isArray(json.points)).toBe(true);
    expect(Array.isArray(json.unmapped)).toBe(true);
  });

  it("adds avatarUrl derived from login when missing from stored point", async () => {
    mockFind.mockResolvedValue(ROW);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].avatarUrl).toBe("https://github.com/a.png");
  });

  it("returns 500 when DB throws", async () => {
    mockFind.mockRejectedValue(new Error("DB error"));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
