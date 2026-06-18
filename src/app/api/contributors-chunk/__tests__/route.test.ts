// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    async limit() { return { success: true }; }
  },
}));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

vi.mock("@/lib/github", () => ({
  fetchContributorsPage: vi.fn(),
  fetchContributorLocations: vi.fn(),
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

vi.mock("@/lib/api-key", () => ({
  hashApiKey: (k: string) => `hash:${k}`,
}));

import { POST } from "@/app/api/contributors-chunk/route";
import { fetchContributorsPage, fetchContributorLocations } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";

type MockFetchContributorsPage = ReturnType<typeof vi.fn>;
type MockFetchContributorLocations = ReturnType<typeof vi.fn>;
type MockGeocodeBatch = ReturnType<typeof vi.fn>;
type MockBulkReadUsers = ReturnType<typeof vi.fn>;

const mockFetchContributorsPage = fetchContributorsPage as unknown as MockFetchContributorsPage;
const mockFetchContributorLocations = fetchContributorLocations as unknown as MockFetchContributorLocations;
const mockGeocodeBatch = geocodeBatch as unknown as MockGeocodeBatch;
const mockBulkReadUsers = bulkReadUsers as unknown as MockBulkReadUsers;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeContributor = (
  overrides: Partial<{ login: string; contributions: number }> = {},
) => ({
  login: overrides.login ?? "alice",
  contributions: overrides.contributions ?? 42,
  type: "User",
});

const makeContributorsPageResult = (overrides: {
  contributors?: ReturnType<typeof makeContributor>[];
  hasMore?: boolean;
  computing?: boolean;
}) => ({
  contributors: overrides.contributors ?? [makeContributor()],
  hasMore: overrides.hasMore ?? false,
  computing: overrides.computing ?? false,
  quotaRemaining: 4500,
});

const makeReq = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/contributors-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/contributors-chunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkReadUsers.mockResolvedValue(new Map());
    mockFetchContributorLocations.mockResolvedValue(new Map());
    mockGeocodeBatch.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("schema validation", () => {
    it("returns 400 when owner is missing", async () => {
      const res = await POST(makeReq({ repo: "myrepo", page: 1 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when page > 5", async () => {
      const res = await POST(makeReq({ owner: "alice", repo: "myrepo", page: 6 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when page < 1", async () => {
      const res = await POST(makeReq({ owner: "alice", repo: "myrepo", page: 0 }));
      expect(res.status).toBe(400);
    });
  });

  describe("chunk processing", () => {
    it("returns mapped points for contributors with geocodable locations", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({
          contributors: [makeContributor({ login: "alice", contributions: 80 })],
        }),
      );
      mockFetchContributorLocations.mockResolvedValueOnce(
        new Map([["alice", "Paris, France"]]),
      );
      mockGeocodeBatch.mockResolvedValueOnce(
        new Map([["Paris, France", [48.85, 2.35]]]),
      );

      const res = await POST(makeReq({ owner: "dietrichgebert", repo: "ponytail", page: 1 }));
      const body = await res.json() as { points: unknown[]; unmapped: unknown[] };

      expect(res.status).toBe(200);
      expect(body.points).toHaveLength(1);
      expect(body.unmapped).toHaveLength(0);
    });

    it("puts contributors without location into unmapped", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({
          contributors: [makeContributor({ login: "nolocale", contributions: 5 })],
        }),
      );
      mockFetchContributorLocations.mockResolvedValueOnce(
        new Map([["nolocale", null]]),
      );
      mockGeocodeBatch.mockResolvedValueOnce(new Map());

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { points: unknown[]; unmapped: unknown[] };

      expect(body.points).toHaveLength(0);
      expect(body.unmapped).toHaveLength(1);
    });

    it("returns computing=true and empty lists when GitHub returns 202", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({ computing: true, contributors: [] }),
      );

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { computing: boolean };

      expect(res.status).toBe(200);
      expect(body.computing).toBe(true);
    });

    it("uses cached DB location for known users instead of calling fetchContributorLocations", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({
          contributors: [makeContributor({ login: "cached-user", contributions: 10 })],
        }),
      );
      mockBulkReadUsers.mockResolvedValueOnce(
        new Map([
          [
            "cached-user",
            {
              login: "cached-user",
              location: "Berlin",
              lat: 52.52,
              lng: 13.4,
              fetchedAt: new Date(),
            },
          ],
        ]),
      );

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { points: unknown[] };

      expect(body.points).toHaveLength(1);
      // fetchContributorLocations must NOT be called for cached users
      expect(mockFetchContributorLocations).not.toHaveBeenCalled();
    });

    it("uses raw location string as geocodeBatch key (gotcha: no lowercasing)", async () => {
      const rawLocation = "San Francisco, CA";
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({
          contributors: [makeContributor({ login: "sf-dev", contributions: 20 })],
        }),
      );
      mockFetchContributorLocations.mockResolvedValueOnce(
        new Map([["sf-dev", rawLocation]]),
      );
      mockGeocodeBatch.mockResolvedValueOnce(new Map([[rawLocation, [37.77, -122.42]]]));

      await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));

      const calledWith = (mockGeocodeBatch.mock.calls[0] as string[][])[0] ?? [];
      expect(calledWith).toContain(rawLocation);
      expect(calledWith).not.toContain(rawLocation.toLowerCase());
    });

    it("returns nextPage when hasMore is true", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({ hasMore: true }),
      );
      mockFetchContributorLocations.mockResolvedValueOnce(new Map([["alice", "Paris"]]));
      mockGeocodeBatch.mockResolvedValueOnce(new Map([["Paris", [48.85, 2.35]]]));

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { nextPage: number | null };

      expect(body.nextPage).toBe(2);
    });

    it("returns nextPage=null when hasMore is false", async () => {
      mockFetchContributorsPage.mockResolvedValueOnce(
        makeContributorsPageResult({ hasMore: false }),
      );
      mockFetchContributorLocations.mockResolvedValueOnce(new Map([["alice", "Paris"]]));
      mockGeocodeBatch.mockResolvedValueOnce(new Map([["Paris", [48.85, 2.35]]]));

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { nextPage: number | null };

      expect(body.nextPage).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns 429 and resetAt on GitHubRateLimitError", async () => {
      const { GitHubRateLimitError: RateLimitError } = await import("@/lib/github");
      const resetAt = Date.now() + 60_000;
      mockFetchContributorsPage.mockRejectedValueOnce(new RateLimitError(resetAt));

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      const body = await res.json() as { error: string; resetAt: number };

      expect(res.status).toBe(429);
      expect(body.error).toBe("rate_limited");
      expect(body.resetAt).toBe(resetAt);
    });

    it("returns 500 on unexpected error", async () => {
      mockFetchContributorsPage.mockRejectedValueOnce(new Error("Network failure"));

      const res = await POST(makeReq({ owner: "owner", repo: "repo", page: 1 }));
      expect(res.status).toBe(500);
    });
  });
});
