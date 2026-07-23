// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchStargazersPage, fetchContributorsPage, fetchContributorLocations, GitHubRateLimitError, GitHubEmptyStargazersError } from "@/lib/github";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeEdge = (overrides: Partial<{
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  repositories: number;
  createdAt: string;
  avatarUrl: string;
  starredAt: string;
  socialAccounts: { provider: string; url: string }[];
}> = {}) => ({
  starredAt: overrides.starredAt ?? "2024-01-15T12:00:00Z",
  node: {
    login: overrides.login ?? "testuser",
    name: overrides.name ?? "Test User",
    bio: overrides.bio ?? null,
    company: overrides.company ?? null,
    location: overrides.location ?? "Paris, France",
    avatarUrl: overrides.avatarUrl ?? "https://avatars.githubusercontent.com/u/1234",
    createdAt: overrides.createdAt ?? "2020-01-01T00:00:00Z",
    followers: { totalCount: overrides.followers ?? 42 },
    following: { totalCount: overrides.following ?? 10 },
    repositories: { totalCount: overrides.repositories ?? 5 },
    socialAccounts: { nodes: overrides.socialAccounts ?? [] },
  },
});

const makeGitHubResponse = (overrides: {
  hasNextPage?: boolean;
  endCursor?: string | null;
  stargazerCount?: number;
  edges?: ReturnType<typeof makeEdge>[];
}) => ({
  data: {
    repository: {
      stargazerCount: overrides.stargazerCount ?? 100,
      stargazers: {
        pageInfo: {
          hasNextPage: overrides.hasNextPage ?? false,
          endCursor: overrides.endCursor ?? null,
        },
        edges: overrides.edges ?? [makeEdge()],
      },
    },
  },
});

const makeOkResponse = (body: unknown, headers: Record<string, string> = {}) => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
};

const makeErrorResponse = (status: number, headers: Record<string, string> = {}) => {
  return new Response("", { status, headers });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchStargazersPage", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test_token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("cursor handling", () => {
    it("sends no cursor variable when cursor is null (first page)", async () => {
      let capturedBody: Record<string, unknown> = {};

      vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse((init?.body as string) ?? "{}");
        return makeOkResponse(makeGitHubResponse({}));
      });

      await fetchStargazersPage("owner", "repo", null);

      // When cursor is null (first page), the variable is intentionally omitted from the
      // GraphQL request. The query declares `$cursor: String` (nullable without !), so
      // an absent variable resolves to null server-side — same effect, cleaner payload.
      expect(capturedBody.variables).toHaveProperty("owner", "owner");
      expect(capturedBody.variables).toHaveProperty("repo", "repo");
      expect((capturedBody.variables as Record<string, unknown>).cursor).toBeUndefined();
    });

    it("passes cursor string when paginating", async () => {
      let capturedBody: Record<string, unknown> = {};

      vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse((init?.body as string) ?? "{}");
        return makeOkResponse(makeGitHubResponse({}));
      });

      await fetchStargazersPage("owner", "repo", "cursor_abc123");

      expect((capturedBody.variables as Record<string, unknown>).cursor).toBe("cursor_abc123");
    });
  });

  describe("pagination signals", () => {
    it("returns nextCursor when hasNextPage is true", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(
          makeGitHubResponse({ hasNextPage: true, endCursor: "Y3Vyc29yOjEwMA==" }),
        ),
      );

      const result = await fetchStargazersPage("owner", "repo", null);

      expect(result.nextCursor).toBe("Y3Vyc29yOjEwMA==");
    });

    it("returns nextCursor=null when hasNextPage is false", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(
          makeGitHubResponse({ hasNextPage: false, endCursor: "some_cursor" }),
        ),
      );

      const result = await fetchStargazersPage("owner", "repo", null);

      expect(result.nextCursor).toBeNull();
    });

    it("returns correct totalCount from stargazerCount", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ stargazerCount: 2847 })),
      );

      const result = await fetchStargazersPage("owner", "repo", null);

      expect(result.totalCount).toBe(2847);
    });
  });

  describe("stargazer data mapping", () => {
    it("maps edge data to StargazerRaw correctly", async () => {
      const edge = makeEdge({
        login: "janedoe",
        name: "Jane Doe",
        bio: "Software engineer",
        company: "@acmecorp",
        location: "Berlin, Germany",
        followers: 150,
        following: 30,
        repositories: 25,
        avatarUrl: "https://avatars.githubusercontent.com/u/9999",
        starredAt: "2024-03-01T08:00:00Z",
        socialAccounts: [{ provider: "LINKEDIN", url: "https://linkedin.com/in/janedoe" }],
      });

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ edges: [edge] })),
      );

      const result = await fetchStargazersPage("owner", "repo", null);
      const sg = result.stargazers[0];

      expect(sg.login).toBe("janedoe");
      expect(sg.name).toBe("Jane Doe");
      expect(sg.bio).toBe("Software engineer");
      // Leading @ on company name must be stripped
      expect(sg.company).toBe("acmecorp");
      expect(sg.location).toBe("Berlin, Germany");
      expect(sg.followers).toBe(150);
      expect(sg.linkedinUrl).toBeNull();
      expect(sg.starredAt).toBe("2024-03-01T08:00:00Z");
    });

    it("strips leading @ from company name", async () => {
      const edge = makeEdge({ company: "@github" });

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ edges: [edge] })),
      );

      const result = await fetchStargazersPage("owner", "repo", null);

      expect(result.stargazers[0].company).toBe("github");
    });

    it("always returns null linkedinUrl (socialAccounts removed from chunk query)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({})),
      );

      const result = await fetchStargazersPage("owner", "repo", null);

      expect(result.stargazers[0].linkedinUrl).toBeNull();
    });
  });

  describe("since parameter — incremental fetch", () => {
    it("stops pagination when a star is older than the since timestamp", async () => {
      const edges = [
        makeEdge({ login: "new_user", starredAt: "2024-06-01T00:00:00Z" }),
        makeEdge({ login: "old_user", starredAt: "2024-01-01T00:00:00Z" }), // older than since
      ];

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ hasNextPage: true, endCursor: "next", edges })),
      );

      const result = await fetchStargazersPage(
        "owner",
        "repo",
        null,
        "2024-03-01T00:00:00Z", // since: March 2024
      );

      // Only the June star should be included; the January star triggered hasMore=false
      expect(result.stargazers).toHaveLength(1);
      expect(result.stargazers[0].login).toBe("new_user");
      // nextCursor must be null because we hit the since boundary
      expect(result.nextCursor).toBeNull();
    });
  });

  // GitHub answered HTTP 200 with an empty stargazers connection while still reporting a
  // non-zero stargazerCount on 2026-07-23. A scan that trusts that response completes with
  // zero users and writes a "ghost" repo (badge_cache row, no map data). See
  // research-ghost-repos.md.
  describe("degraded empty-list response", () => {
    it("throws GitHubEmptyStargazersError when the first page is empty but stars exist", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ stargazerCount: 264, edges: [], hasNextPage: false })),
      );

      await expect(fetchStargazersPage("owner", "repo", null)).rejects.toThrow(
        GitHubEmptyStargazersError,
      );
    });

    it("carries the reported star count on the error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ stargazerCount: 264, edges: [] })),
      );

      await expect(fetchStargazersPage("owner", "repo", null)).rejects.toMatchObject({
        totalCount: 264,
      });
    });

    it("accepts an empty first page when the repo genuinely has zero stars", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ stargazerCount: 0, edges: [] })),
      );

      const result = await fetchStargazersPage("owner", "repo", null);
      expect(result.stargazers).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it("accepts an empty page mid-pagination — the guard only covers the first page", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ stargazerCount: 264, edges: [] })),
      );

      const result = await fetchStargazersPage("owner", "repo", "cursor_abc123");
      expect(result.stargazers).toEqual([]);
    });

    it("accepts an empty first page on an incremental refresh (since filters everything out)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(
          makeGitHubResponse({
            stargazerCount: 264,
            edges: [makeEdge({ starredAt: "2020-01-01T00:00:00Z" })],
          }),
        ),
      );

      const result = await fetchStargazersPage("owner", "repo", null, "2024-01-01T00:00:00Z");
      expect(result.stargazers).toEqual([]);
    });
  });

  describe("rate limit handling", () => {
    it("throws GitHubRateLimitError on 403 with x-ratelimit-reset header", async () => {
      const resetEpoch = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeErrorResponse(403, { "x-ratelimit-reset": String(resetEpoch) }),
      );

      await expect(fetchStargazersPage("owner", "repo", null)).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it("throws GitHubRateLimitError on 429 with retry-after header", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeErrorResponse(429, { "retry-after": "120" }),
      );

      let caught: GitHubRateLimitError | null = null;
      try {
        await fetchStargazersPage("owner", "repo", null);
      } catch (e) {
        caught = e as GitHubRateLimitError;
      }

      expect(caught).toBeInstanceOf(GitHubRateLimitError);
      // resetAt should be roughly now + 120s
      expect(caught!.resetAt).toBeGreaterThan(Date.now());
      expect(caught!.resetAt).toBeLessThan(Date.now() + 130_000);
    });

    it("uses 60s fallback resetAt when no rate limit headers present", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeErrorResponse(403));

      let caught: GitHubRateLimitError | null = null;
      try {
        await fetchStargazersPage("owner", "repo", null);
      } catch (e) {
        caught = e as GitHubRateLimitError;
      }

      expect(caught).toBeInstanceOf(GitHubRateLimitError);
      expect(caught!.resetAt).toBeGreaterThan(Date.now() + 50_000);
      expect(caught!.resetAt).toBeLessThan(Date.now() + 70_000);
    });

    it("throws a plain Error on other non-ok status codes", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeErrorResponse(500));

      await expect(fetchStargazersPage("owner", "repo", null)).rejects.toThrow(
        "GitHub API error: 500",
      );
    });
  });

  describe("GraphQL errors", () => {
    it("throws when the GraphQL response contains errors", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse({ errors: [{ message: "Repository not found" }] }),
      );

      await expect(fetchStargazersPage("owner", "repo", null)).rejects.toThrow(
        "Repository not found",
      );
    });
  });
});

// ─── fetchContributorsPage ─────────────────────────────────────────────────────

const makeContributor = (overrides: Partial<{ login: string; contributions: number }> = {}) => ({
  login: overrides.login ?? "contributor1",
  contributions: overrides.contributions ?? 42,
  type: "User",
});

const makeContribResponse = (
  contributors: ReturnType<typeof makeContributor>[],
  status = 200,
  linkHeader?: string,
) =>
  new Response(JSON.stringify(contributors), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(linkHeader ? { Link: linkHeader } : {}),
      "x-ratelimit-remaining": "4999",
    },
  });

describe("fetchContributorsPage", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test_token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns contributors list on a successful page 1 response", async () => {
    const contributors = [
      makeContributor({ login: "alice", contributions: 100 }),
      makeContributor({ login: "bob", contributions: 50 }),
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeContribResponse(contributors));

    const result = await fetchContributorsPage("owner", "repo", 1);

    expect(result.contributors).toHaveLength(2);
    expect(result.contributors[0].login).toBe("alice");
    expect(result.contributors[0].contributions).toBe(100);
    expect(result.contributors[1].login).toBe("bob");
  });

  it("returns hasMore=true when Link rel=next is present", async () => {
    const contributors = Array.from({ length: 100 }, (_, i) =>
      makeContributor({ login: `user${i}`, contributions: 10 }),
    );
    const linkHeader = '<https://api.github.com/repos/owner/repo/contributors?page=2>; rel="next", <https://api.github.com/repos/owner/repo/contributors?page=3>; rel="last"';
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeContribResponse(contributors, 200, linkHeader),
    );

    const result = await fetchContributorsPage("owner", "repo", 1);

    expect(result.hasMore).toBe(true);
  });

  it("returns hasMore=false when no Link rel=next is present", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeContribResponse([makeContributor()]),
    );

    const result = await fetchContributorsPage("owner", "repo", 1);

    expect(result.hasMore).toBe(false);
  });

  it("returns empty list with hasMore=false when page exceeds data (empty array)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(makeContribResponse([]));

    const result = await fetchContributorsPage("owner", "repo", 5);

    expect(result.contributors).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("retries and returns 202 as a retrievable signal", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 202 }),
    );

    const result = await fetchContributorsPage("owner", "repo", 1);

    expect(result.computing).toBe(true);
    expect(result.contributors).toHaveLength(0);
  });

  it("throws GitHubRateLimitError on 429", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 429, headers: { "retry-after": "60" } }),
    );

    await expect(fetchContributorsPage("owner", "repo", 1)).rejects.toThrow(GitHubRateLimitError);
  });

  it("throws GitHubRateLimitError on 403 with rate limit header", async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 3600;
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", {
        status: 403,
        headers: { "x-ratelimit-reset": String(resetEpoch) },
      }),
    );

    await expect(fetchContributorsPage("owner", "repo", 1)).rejects.toThrow(GitHubRateLimitError);
  });

  it("uses clientToken when provided", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return makeContribResponse([makeContributor()]);
    });

    await fetchContributorsPage("owner", "repo", 1, "ghp_client");

    expect(capturedHeaders.authorization).toBe("token ghp_client");
  });

  it("filters out non-User type contributors (bots)", async () => {
    const contributors = [
      { login: "humandev", contributions: 80, type: "User" },
      { login: "dependabot[bot]", contributions: 20, type: "Bot" },
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      makeContribResponse(contributors as ReturnType<typeof makeContributor>[]),
    );

    const result = await fetchContributorsPage("owner", "repo", 1);

    expect(result.contributors.every((c) => c.type === "User")).toBe(true);
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0].login).toBe("humandev");
  });
});

describe("fetchStargazersPage — authentication", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test_token");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses clientToken header over GITHUB_TOKEN env when both are set", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return makeOkResponse(makeGitHubResponse({}));
    });

    await fetchStargazersPage("owner", "repo", null, undefined, "ghp_client_token");

    expect(capturedHeaders.authorization).toBe("Bearer ghp_client_token");
  });

  it("falls back to GITHUB_TOKEN env when no clientToken is provided", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return makeOkResponse(makeGitHubResponse({}));
    });

    await fetchStargazersPage("owner", "repo", null);

    expect(capturedHeaders.authorization).toBe("Bearer ghp_test_token");
  });

  it("sends no Authorization header when no token is available", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_TOKEN", "");

    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      return makeOkResponse(makeGitHubResponse({}));
    });

    await fetchStargazersPage("owner", "repo", null);

    expect(capturedHeaders.authorization).toBeUndefined();
  });
});
