import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchStargazersPage, GitHubRateLimitError } from "@/lib/github";

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

      // The GraphQL variables object must have cursor === null when passed as null.
      // Critical: the query uses `$cursor: String` (nullable), so null is valid GraphQL.
      // What we're guarding against is *undefined* being serialized as missing.
      expect(capturedBody.variables).toHaveProperty("owner", "owner");
      expect(capturedBody.variables).toHaveProperty("repo", "repo");
      expect(capturedBody.variables).toHaveProperty("cursor", null);
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
      expect(sg.linkedinUrl).toBe("https://linkedin.com/in/janedoe");
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

    it("returns null linkedinUrl when no LinkedIn social account exists", async () => {
      const edge = makeEdge({
        socialAccounts: [{ provider: "TWITTER", url: "https://twitter.com/user" }],
      });

      vi.spyOn(global, "fetch").mockResolvedValueOnce(
        makeOkResponse(makeGitHubResponse({ edges: [edge] })),
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

  describe("authentication", () => {
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
});
