// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/github", () => ({
  fetchContributorsPage: vi.fn(),
  fetchContributorLocations: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) { super("rate_limited"); this.resetAt = resetAt; }
  },
  GitHubTokenInvalidError: class GitHubTokenInvalidError extends Error {
    constructor() { super("token_invalid"); }
  },
}));

import {
  fetchContributorsPage,
  fetchContributorLocations,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";
import { GET } from "./route";

const makeParams = (owner = "vercel", repo = "next.js") =>
  Promise.resolve({ owner, repo });

const makeReq = (path = "/api/mcp/contributors/vercel/next.js", search = "") =>
  new NextRequest(`http://localhost${path}${search}`);

const makeContributor = (login: string, contributions = 100) => ({
  login,
  contributions,
  type: "User",
});

const makePage = (overrides: Partial<{
  contributors: ReturnType<typeof makeContributor>[];
  hasMore: boolean;
  computing: boolean;
  quotaRemaining: number | null;
}> = {}) => ({
  contributors: overrides.contributors ?? [makeContributor("gaearon")],
  hasMore: overrides.hasMore ?? false,
  computing: overrides.computing ?? false,
  quotaRemaining: overrides.quotaRemaining ?? 4000,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mcp/contributors/[owner]/[repo]", () => {
  it("returns 400 for invalid owner/repo params", async () => {
    const res = await GET(makeReq(), { params: makeParams("bad owner", "repo") });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_params");
  });

  it("returns contributor list for a happy path request", async () => {
    vi.mocked(fetchContributorsPage).mockResolvedValue(makePage({
      contributors: [makeContributor("gaearon", 250), makeContributor("timneutkens", 180)],
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contributors).toHaveLength(2);
    expect(body.contributors[0].login).toBe("gaearon");
    expect(body.contributors[0].contributions).toBe(250);
    expect(body.contributors[0].profileUrl).toBe("https://github.com/gaearon");
    expect(body.shownCount).toBe(2);
    expect(body.computing).toBe(false);
  });

  it("returns computing:true with empty list when GitHub is still computing", async () => {
    vi.mocked(fetchContributorsPage).mockResolvedValue(makePage({ computing: true, contributors: [] }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.computing).toBe(true);
    expect(body.contributors).toHaveLength(0);
  });

  it("enriches contributors with location when ?withLocations=1", async () => {
    vi.mocked(fetchContributorsPage).mockResolvedValue(makePage({
      contributors: [makeContributor("gaearon")],
    }));
    vi.mocked(fetchContributorLocations).mockResolvedValue(
      new Map([["gaearon", "New York, NY"]]),
    );
    const res = await GET(makeReq("/api/mcp/contributors/vercel/next.js", "?withLocations=1"), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contributors[0].location).toBe("New York, NY");
    expect(vi.mocked(fetchContributorLocations)).toHaveBeenCalledWith(["gaearon"], undefined);
  });

  it("does not call fetchContributorLocations when withLocations is not set", async () => {
    vi.mocked(fetchContributorsPage).mockResolvedValue(makePage());
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    expect(vi.mocked(fetchContributorLocations)).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(fetchContributorsPage).mockRejectedValue(new GitHubTokenInvalidError());
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 429 with resetAt when rate limited", async () => {
    const resetAt = Date.now() + 60_000;
    vi.mocked(fetchContributorsPage).mockRejectedValue(new GitHubRateLimitError(resetAt));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe(resetAt);
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(fetchContributorsPage).mockRejectedValue(new Error("Network failure"));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(500);
  });
});
