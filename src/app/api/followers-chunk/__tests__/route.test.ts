// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks (must come before importing the route) ─────────────────────────────

const mockRateLimit = vi.hoisted(() => vi.fn(async (_identifier?: string) => ({ success: true })));

// Upstash rate limiter — stub so getLimiter() returns null (fail-open) in tests.
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    async limit(identifier: string) { return mockRateLimit(identifier); }
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

vi.mock("@/lib/github", () => ({
  fetchFollowersPage: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) {
      super("rate_limited");
      this.name = "GitHubRateLimitError";
      this.resetAt = resetAt;
    }
  },
  GitHubTokenInvalidError: class GitHubTokenInvalidError extends Error {
    constructor() {
      super("token_invalid");
      this.name = "GitHubTokenInvalidError";
    }
  },
}));

vi.mock("@/lib/geocoder", () => ({
  geocodeBatch: vi.fn(),
}));

vi.mock("@/lib/user-cache", () => ({
  bulkReadUsers: vi.fn().mockResolvedValue(new Map()),
}));

// hashApiKey imported by route — mock to avoid pulling in node:crypto and
// disrupting Vitest's ESM mock hoisting for @upstash/ratelimit/@upstash/redis.
vi.mock("@/lib/api-key", () => ({
  hashApiKey: (k: string) => `hash:${k}`,
}));

import { POST } from "@/app/api/followers-chunk/route";
import { fetchFollowersPage } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";

// ─── Type helpers ─────────────────────────────────────────────────────────────

type MockFetchFollowersPage = ReturnType<typeof vi.fn>;
type MockGeocodeBatch = ReturnType<typeof vi.fn>;
type MockBulkReadUsers = ReturnType<typeof vi.fn>;

const mockFetchFollowersPage = fetchFollowersPage as unknown as MockFetchFollowersPage;
const mockGeocodeBatch = geocodeBatch as unknown as MockGeocodeBatch;
const mockBulkReadUsers = bulkReadUsers as unknown as MockBulkReadUsers;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeFollower = (overrides: Partial<{
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  accountCreatedAt: string | null;
  avatarUrl: string;
}> = {}) => ({
  login: overrides.login ?? "testuser",
  name: overrides.name ?? "Test User",
  bio: overrides.bio ?? null,
  company: overrides.company ?? null,
  location: overrides.location ?? "Paris, France",
  followers: overrides.followers ?? 10,
  following: overrides.following ?? 5,
  publicRepos: overrides.publicRepos ?? 8,
  accountCreatedAt: overrides.accountCreatedAt ?? "2020-01-01T00:00:00Z",
  avatarUrl: overrides.avatarUrl ?? "https://avatars.githubusercontent.com/u/1",
});

const makeFollowersPage = (overrides: {
  followers?: ReturnType<typeof makeFollower>[];
  nextCursor?: string | null;
  totalCount?: number;
  quotaRemaining?: number | null;
} = {}) => ({
  followers: overrides.followers ?? [makeFollower()],
  nextCursor: overrides.nextCursor ?? null,
  totalCount: overrides.totalCount ?? 1,
  quotaRemaining: overrides.quotaRemaining ?? 4999,
});

const makeRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  return new NextRequest("http://localhost/api/followers-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/followers-chunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ success: true });
    // Sensible defaults for happy path
    mockFetchFollowersPage.mockResolvedValue(makeFollowersPage());
    mockGeocodeBatch.mockResolvedValue(new Map([["Paris, France", [48.8566, 2.3522]]]));
    mockBulkReadUsers.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful response shape", () => {
    it("returns 200 with points when geocoding succeeds", async () => {
      const follower = makeFollower({ login: "jdoe", location: "Berlin, Germany" });
      mockFetchFollowersPage.mockResolvedValueOnce(
        makeFollowersPage({ followers: [follower] }),
      );
      mockGeocodeBatch.mockResolvedValueOnce(
        new Map([["Berlin, Germany", [52.52, 13.405]]]),
      );

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.points).toHaveLength(1);
      expect(body.points[0].login).toBe("jdoe");
      // Route rounds coords to 2 decimals for privacy (~1.1km precision)
      expect(body.points[0].lat).toBe(52.52);
      expect(body.points[0].lng).toBe(13.41); // 13.405 → Math.round(1340.5)/100 = 13.41
      expect(body.unmapped).toHaveLength(0);
    });

    it("puts followers without location into unmapped", async () => {
      const follower = makeFollower({ login: "ghost", location: null });
      mockFetchFollowersPage.mockResolvedValueOnce(
        makeFollowersPage({ followers: [follower] }),
      );
      mockGeocodeBatch.mockResolvedValueOnce(new Map());

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.unmapped).toHaveLength(1);
      expect(body.unmapped[0].login).toBe("ghost");
      expect(body.points).toHaveLength(0);
    });

    it("puts followers with unresolvable location into unmapped", async () => {
      const follower = makeFollower({ login: "wanderer", location: "somewhere unknown" });
      mockFetchFollowersPage.mockResolvedValueOnce(
        makeFollowersPage({ followers: [follower] }),
      );
      // geocodeBatch returns no match for this location
      mockGeocodeBatch.mockResolvedValueOnce(new Map());

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.unmapped).toHaveLength(1);
      expect(body.unmapped[0].login).toBe("wanderer");
      expect(body.points).toHaveLength(0);
    });

    it("unmapped entry includes avatarUrl", async () => {
      const follower = makeFollower({
        login: "ghost",
        location: null,
        avatarUrl: "https://avatars.githubusercontent.com/u/42",
      });
      mockFetchFollowersPage.mockResolvedValueOnce(
        makeFollowersPage({ followers: [follower] }),
      );
      mockGeocodeBatch.mockResolvedValueOnce(new Map());

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.unmapped).toHaveLength(1);
      expect(body.unmapped[0].avatarUrl).toBe("https://avatars.githubusercontent.com/u/42");
    });

    it("returns totalCount and nextCursor from GitHub page", async () => {
      mockFetchFollowersPage.mockResolvedValueOnce(
        makeFollowersPage({ nextCursor: "cursor_xyz", totalCount: 250 }),
      );

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.totalCount).toBe(250);
      expect(body.nextCursor).toBe("cursor_xyz");
    });

    it("passes cursor from request body to fetchFollowersPage", async () => {
      const req = makeRequest({ login: "octocat", cursor: "existing_cursor" });
      await POST(req);

      expect(mockFetchFollowersPage).toHaveBeenCalledWith(
        "octocat",
        "existing_cursor",
        undefined,
      );
    });
  });

  describe("input validation", () => {
    it("returns 400 on invalid login", async () => {
      const req = makeRequest({ login: "invalid/login" });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 when login is missing", async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe("error handling", () => {
    it("returns 429 on GitHub rate limit with resetAt", async () => {
      const { GitHubRateLimitError: RateLimitError } = await import("@/lib/github");
      const resetAt = Date.now() + 3600_000;
      mockFetchFollowersPage.mockRejectedValueOnce(new RateLimitError(resetAt));

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe("rate_limited");
      expect(typeof body.resetAt).toBe("number");
      expect(body.resetAt).toBe(resetAt);
    });

    it("returns 401 on invalid token", async () => {
      const { GitHubTokenInvalidError } = await import("@/lib/github");
      mockFetchFollowersPage.mockRejectedValueOnce(new GitHubTokenInvalidError());

      const req = makeRequest({ login: "octocat" }, { "x-gh-token": "ghp_expired" });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("github_token_invalid");
    });

    it("returns 429 when IP rate limiter rejects the request", async () => {
      mockRateLimit.mockResolvedValueOnce({ success: false });

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);

      expect(res.status).toBe(429);
      expect(mockFetchFollowersPage).not.toHaveBeenCalled();
    });

    it("returns 500 on unexpected errors", async () => {
      mockFetchFollowersPage.mockRejectedValueOnce(new Error("Unexpected failure"));

      const req = makeRequest({ login: "octocat" });
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  });
});
