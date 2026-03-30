import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks (must come before importing the route) ─────────────────────────────

vi.mock("@/lib/github", () => ({
  fetchStargazersPage: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) {
      super("rate_limited");
      this.name = "GitHubRateLimitError";
      this.resetAt = resetAt;
    }
  },
}));

vi.mock("@/lib/geocoder", () => ({
  geocodeBatch: vi.fn(),
}));

vi.mock("@/lib/db-health", () => ({
  checkDbHealth: vi.fn().mockResolvedValue({ ok: true, usagePct: 10 }),
  DB_WARN_PCT: 80,
}));

vi.mock("@/lib/user-cache", () => ({
  bulkUpsertUsers: vi.fn().mockResolvedValue(true),
  bulkUpsertStarEvents: vi.fn().mockResolvedValue(undefined),
  bulkReadUsers: vi.fn().mockResolvedValue(new Map()),
}));

import { POST } from "@/app/api/chunk/route";
import { fetchStargazersPage, GitHubRateLimitError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";

// ─── Type helpers ─────────────────────────────────────────────────────────────

type MockFetchStargazers = ReturnType<typeof vi.fn>;
type MockGeocodeBatch = ReturnType<typeof vi.fn>;
type MockBulkReadUsers = ReturnType<typeof vi.fn>;

const mockFetchStargazers = fetchStargazersPage as unknown as MockFetchStargazers;
const mockGeocodeBatch = geocodeBatch as unknown as MockGeocodeBatch;
const mockBulkReadUsers = bulkReadUsers as unknown as MockBulkReadUsers;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeStargazer = (overrides: Partial<{
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
  starredAt: string;
  linkedinUrl: string | null;
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
  starredAt: overrides.starredAt ?? "2024-01-01T00:00:00Z",
  linkedinUrl: overrides.linkedinUrl ?? null,
});

const makeStargazersPage = (overrides: {
  stargazers?: ReturnType<typeof makeStargazer>[];
  nextCursor?: string | null;
  totalCount?: number;
} = {}) => ({
  stargazers: overrides.stargazers ?? [makeStargazer()],
  nextCursor: overrides.nextCursor ?? null,
  totalCount: overrides.totalCount ?? 1,
});

const makeRequest = (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  return new NextRequest("http://localhost/api/chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/chunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults for happy path
    mockFetchStargazers.mockResolvedValue(makeStargazersPage());
    mockGeocodeBatch.mockResolvedValue(new Map([["Paris, France", [48.8566, 2.3522]]]));
    mockBulkReadUsers.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("input validation", () => {
    it("returns 400 when owner is missing", async () => {
      const req = makeRequest({ repo: "starmapper" });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 when repo is missing", async () => {
      const req = makeRequest({ owner: "octocat" });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("returns 400 when both owner and repo are missing", async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("returns 400 when owner contains invalid characters", async () => {
      const req = makeRequest({ owner: "evil/owner", repo: "repo" });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("returns 400 when repo contains invalid characters", async () => {
      const req = makeRequest({ owner: "octocat", repo: "repo with spaces" });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("returns 400 when since is not a valid ISO timestamp", async () => {
      const req = makeRequest({ owner: "octocat", repo: "repo", since: "not-a-date" });
      const res = await POST(req);

      expect(res.status).toBe(400);
    });

    it("accepts valid owner/repo with dots and hyphens", async () => {
      const req = makeRequest({ owner: "my-org", repo: "my.repo-v2" });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe("successful response shape", () => {
    it("returns 200 with points, unmapped, nextCursor and totalCount", async () => {
      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("points");
      expect(body).toHaveProperty("unmapped");
      expect(body).toHaveProperty("nextCursor");
      expect(body).toHaveProperty("totalCount");
    });

    it("returns totalCount from GitHub", async () => {
      mockFetchStargazers.mockResolvedValueOnce(makeStargazersPage({ totalCount: 1234 }));
      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      const body = await res.json();
      expect(body.totalCount).toBe(1234);
    });

    it("maps geocoded users to points array", async () => {
      const stargazer = makeStargazer({ login: "jdoe", location: "Berlin, Germany" });
      mockFetchStargazers.mockResolvedValueOnce(makeStargazersPage({ stargazers: [stargazer] }));
      mockGeocodeBatch.mockResolvedValueOnce(
        new Map([["Berlin, Germany", [52.52, 13.405]]]),
      );

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.points).toHaveLength(1);
      expect(body.points[0].login).toBe("jdoe");
      expect(body.points[0].lat).toBe(52.52);
      expect(body.points[0].lng).toBe(13.405);
      expect(body.unmapped).toHaveLength(0);
    });

    it("places users with no location or failed geocode in unmapped", async () => {
      const stargazer = makeStargazer({ login: "ghost", location: null });
      mockFetchStargazers.mockResolvedValueOnce(makeStargazersPage({ stargazers: [stargazer] }));
      mockGeocodeBatch.mockResolvedValueOnce(new Map());

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.unmapped).toHaveLength(1);
      expect(body.unmapped[0].login).toBe("ghost");
      expect(body.points).toHaveLength(0);
    });

    it("returns nextCursor from GitHub page info", async () => {
      mockFetchStargazers.mockResolvedValueOnce(
        makeStargazersPage({ nextCursor: "cursor_abc", totalCount: 200 }),
      );

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.nextCursor).toBe("cursor_abc");
    });

    it("returns nextCursor=null on last page", async () => {
      mockFetchStargazers.mockResolvedValueOnce(
        makeStargazersPage({ nextCursor: null }),
      );

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.nextCursor).toBeNull();
    });

    it("passes cursor from request body to fetchStargazersPage", async () => {
      const req = makeRequest({ owner: "octocat", repo: "starmapper", cursor: "existing_cursor" });
      await POST(req);

      expect(mockFetchStargazers).toHaveBeenCalledWith(
        "octocat",
        "starmapper",
        "existing_cursor",
        undefined,
        undefined,
      );
    });

    it("passes x-gh-token header to fetchStargazersPage as clientToken", async () => {
      const req = makeRequest(
        { owner: "octocat", repo: "starmapper" },
        { "x-gh-token": "ghp_user_pat" },
      );
      await POST(req);

      expect(mockFetchStargazers).toHaveBeenCalledWith(
        "octocat",
        "starmapper",
        null,
        undefined,
        "ghp_user_pat",
      );
    });

    it("returns latestStarredAt from the first stargazer (most recent — DESC order)", async () => {
      const sg = makeStargazer({ starredAt: "2024-12-01T00:00:00Z" });
      mockFetchStargazers.mockResolvedValueOnce(makeStargazersPage({ stargazers: [sg] }));
      mockGeocodeBatch.mockResolvedValueOnce(
        new Map([["Paris, France", [48.8566, 2.3522]]]),
      );

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      expect(body.latestStarredAt).toBe("2024-12-01T00:00:00Z");
    });
  });

  describe("user cache integration", () => {
    it("uses cached user coordinates without calling geocodeBatch for that user", async () => {
      const sg = makeStargazer({ login: "cacheduser", location: "Paris, France" });
      mockFetchStargazers.mockResolvedValueOnce(makeStargazersPage({ stargazers: [sg] }));

      // Simulate cache hit: user already has coords, fetchedAt is recent
      mockBulkReadUsers.mockResolvedValueOnce(
        new Map([
          [
            "cacheduser",
            {
              lat: 48.8566,
              lng: 2.3522,
              location: "Paris, France",
              fetchedAt: new Date(), // recent — not stale
              dataVersion: 1,
            },
          ],
        ]),
      );

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);
      const body = await res.json();

      // The user should appear in points using cached coords
      expect(body.points).toHaveLength(1);
      expect(body.points[0].lat).toBe(48.8566);
      // geocodeBatch should have been called with an empty locations array (no misses)
      const geocodedLocations = mockGeocodeBatch.mock.calls[0][0] as string[];
      expect(geocodedLocations).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("returns 429 with resetAt when GitHub rate limit is hit", async () => {
      const { GitHubRateLimitError: RateLimitError } = await import("@/lib/github");
      const resetAt = Date.now() + 3600_000;
      mockFetchStargazers.mockRejectedValueOnce(new RateLimitError(resetAt));

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe("rate_limited");
      expect(body.resetAt).toBe(resetAt);
    });

    it("returns 500 on unexpected errors", async () => {
      mockFetchStargazers.mockRejectedValueOnce(new Error("Unexpected DB failure"));

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns the GitHub API error message in the 500 body", async () => {
      mockFetchStargazers.mockRejectedValueOnce(new Error("GitHub API error: 404"));

      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("GitHub API error: 404");
    });

    it("returns 429 when MAX_CONCURRENT sessions are active — cannot test concurrency limit in unit tests but validates the fast path", async () => {
      // This test documents the behavior. The in-memory counter resets between calls
      // in the test environment, so we can only verify normal requests pass through.
      const req = makeRequest({ owner: "octocat", repo: "starmapper" });
      const res = await POST(req);

      // Under normal conditions (no concurrent sessions), expect 200
      expect(res.status).toBe(200);
    });
  });
});
