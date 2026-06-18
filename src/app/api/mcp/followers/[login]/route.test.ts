// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/github", () => ({
  fetchFollowersPage: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) { super("rate_limited"); this.resetAt = resetAt; }
  },
  GitHubTokenInvalidError: class GitHubTokenInvalidError extends Error {
    constructor() { super("token_invalid"); }
  },
}));

import {
  fetchFollowersPage,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";
import { GET } from "./route";

const makeParams = (login = "gaearon") => Promise.resolve({ login });
const makeReq = (login = "gaearon") =>
  new NextRequest(`http://localhost/api/mcp/followers/${login}`);

const makeFollower = (login: string, followers = 100, overrides: Partial<{
  name: string | null;
  company: string | null;
  location: string | null;
}> = {}) => ({
  login,
  name: overrides.name ?? null,
  bio: null,
  company: overrides.company ?? null,
  location: overrides.location ?? null,
  followers,
  following: 10,
  publicRepos: 20,
  accountCreatedAt: "2015-01-01T00:00:00Z",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
});

const makePage = (overrides: Partial<{
  followers: ReturnType<typeof makeFollower>[];
  totalCount: number;
  nextCursor: string | null;
  quotaRemaining: number | null;
}> = {}) => ({
  followers: overrides.followers ?? [makeFollower("octocat")],
  totalCount: overrides.totalCount ?? 1,
  nextCursor: overrides.nextCursor ?? null,
  quotaRemaining: overrides.quotaRemaining ?? 4000,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mcp/followers/[login]", () => {
  it("returns 400 for an invalid login (leading hyphen)", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue(makePage());
    const res = await GET(makeReq("-invalid"), { params: makeParams("-invalid") });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_params");
  });

  it("returns follower list sorted by followers desc", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue(makePage({
      followers: [
        makeFollower("casual", 50),
        makeFollower("celebrity", 50000),
        makeFollower("regular", 500),
      ],
      totalCount: 3,
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.followers[0].login).toBe("celebrity");
    expect(body.followers[1].login).toBe("regular");
    expect(body.followers[2].login).toBe("casual");
    expect(body.shownCount).toBe(3);
    expect(body.totalCount).toBe(3);
    expect(body.truncated).toBe(false);
  });

  it("sets truncated:true when totalCount exceeds shownCount", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue(makePage({
      followers: Array.from({ length: 100 }, (_, i) => makeFollower(`user${i}`, 100 - i)),
      totalCount: 5000,
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.totalCount).toBe(5000);
    expect(body.shownCount).toBe(100);
  });

  it("includes profileUrl for each follower", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue(makePage({
      followers: [makeFollower("gaearon", 100)],
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    const body = await res.json();
    expect(body.followers[0].profileUrl).toBe("https://github.com/gaearon");
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(fetchFollowersPage).mockRejectedValue(new GitHubTokenInvalidError());
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 429 with resetAt when rate limited", async () => {
    const resetAt = Date.now() + 60_000;
    vi.mocked(fetchFollowersPage).mockRejectedValue(new GitHubRateLimitError(resetAt));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe(resetAt);
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(fetchFollowersPage).mockRejectedValue(new Error("Network failure"));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(500);
  });
});
