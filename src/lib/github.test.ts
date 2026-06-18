// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchStargazersPage,
  fetchFollowersPage,
  fetchRepoDependencies,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";

// ─── Fixtures ────────────────────────────────────────────────────────────────

type EdgeOverride = {
  starredAt?: string;
  login?: string;
  company?: string;
  socialAccounts?: { nodes: { provider: string; url: string }[] };
};

const makeEdge = (o: EdgeOverride = {}) => ({
  starredAt: o.starredAt ?? "2024-06-01T00:00:00Z",
  node: {
    login: o.login ?? "octocat",
    name: "The Octocat",
    bio: null,
    company: o.company ?? null,
    location: "San Francisco, CA",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    createdAt: "2011-01-25T18:44:36Z",
    followers: { totalCount: 100 },
    following: { totalCount: 10 },
    repositories: { totalCount: 50 },
    socialAccounts: o.socialAccounts ?? { nodes: [] },
  },
});

const makeGraphQLResponse = (overrides: {
  edges?: ReturnType<typeof makeEdge>[];
  hasNextPage?: boolean;
  endCursor?: string | null;
  stargazerCount?: number;
} = {}) => ({
  data: {
    repository: {
      stargazerCount: overrides.stargazerCount ?? 1,
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

const mockFetchOk = (body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );

const mockFetchError = (status: number, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(null, { status, headers }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fetchStargazersPage()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  // ── Rate limit handling ────────────────────────────────────────────────────

  describe("rate limit handling", () => {
    it("throws GitHubRateLimitError with resetAt derived from retry-after header", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchError(403, { "retry-after": "60" }));
      const before = Date.now();
      await expect(fetchStargazersPage("o", "r", null)).rejects.toBeInstanceOf(GitHubRateLimitError);
      try {
        await fetchStargazersPage("o", "r", null);
      } catch (e) {
        const err = e as GitHubRateLimitError;
        expect(err.resetAt).toBeGreaterThanOrEqual(before + 60_000);
        expect(err.resetAt).toBeLessThan(before + 90_000);
      }
    });

    it("throws GitHubRateLimitError with resetAt derived from x-ratelimit-reset header", async () => {
      const resetEpoch = Math.floor(Date.now() / 1000) + 3600;
      vi.mocked(fetch).mockReturnValue(
        mockFetchError(403, { "x-ratelimit-reset": String(resetEpoch) }),
      );
      await expect(fetchStargazersPage("o", "r", null)).rejects.toBeInstanceOf(GitHubRateLimitError);
    });

    it("uses fallback resetAt of now+60s when no relevant headers are present", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchError(429, {}));
      const before = Date.now();
      try {
        await fetchStargazersPage("o", "r", null);
      } catch (e) {
        const err = e as GitHubRateLimitError;
        expect(err.resetAt).toBeGreaterThanOrEqual(before + 55_000);
        expect(err.resetAt).toBeLessThanOrEqual(before + 65_000);
      }
    });

    it("throws a generic Error (not GitHubRateLimitError) for non-rate-limit HTTP errors", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchError(500, {}));
      await expect(fetchStargazersPage("o", "r", null)).rejects.toThrow("GitHub API error: 500");
      await expect(fetchStargazersPage("o", "r", null)).rejects.not.toBeInstanceOf(GitHubRateLimitError);
    });
  });

  // ── GraphQL error handling ─────────────────────────────────────────────────

  describe("GraphQL error handling", () => {
    it("throws with the first GraphQL error message when errors array is present", async () => {
      vi.mocked(fetch).mockReturnValue(
        mockFetchOk({ errors: [{ message: "Could not resolve to a Repository" }] }),
      );
      await expect(fetchStargazersPage("o", "r", null)).rejects.toThrow(
        "Could not resolve to a Repository",
      );
    });
  });

  // ── Cursor handling ────────────────────────────────────────────────────────

  describe("cursor handling", () => {
    it("omits cursor variable when cursor is null (first page)", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse()));
      await fetchStargazersPage("octocat", "hello-world", null);

      const call = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as { variables: Record<string, unknown> };
      expect(body.variables).not.toHaveProperty("cursor");
      expect(body.variables).toMatchObject({ owner: "octocat", repo: "hello-world" });
    });

    it("includes cursor variable when cursor is a string", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse()));
      await fetchStargazersPage("octocat", "hello-world", "cursor_abc");

      const call = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(call[1]?.body as string) as { variables: Record<string, unknown> };
      expect(body.variables).toMatchObject({ cursor: "cursor_abc" });
    });
  });

  // ── since timestamp filtering ──────────────────────────────────────────────

  describe("since timestamp filtering", () => {
    it("stops including stargazers when starredAt is at or before the since threshold", async () => {
      const edges = [
        makeEdge({ login: "new_user", starredAt: "2024-06-15T00:00:00Z" }),
        makeEdge({ login: "old_user", starredAt: "2024-01-01T00:00:00Z" }),
      ];
      vi.mocked(fetch).mockReturnValue(
        mockFetchOk(makeGraphQLResponse({ edges, hasNextPage: true, endCursor: "cursor_next" })),
      );

      const result = await fetchStargazersPage("o", "r", null, "2024-01-01T00:00:00Z");
      expect(result.stargazers).toHaveLength(1);
      expect(result.stargazers[0].login).toBe("new_user");
    });

    it("sets nextCursor to null when since threshold is hit mid-page", async () => {
      const edges = [
        makeEdge({ login: "new_user", starredAt: "2024-06-15T00:00:00Z" }),
        makeEdge({ login: "old_user", starredAt: "2024-01-01T00:00:00Z" }),
      ];
      vi.mocked(fetch).mockReturnValue(
        mockFetchOk(makeGraphQLResponse({ edges, hasNextPage: true, endCursor: "cursor_next" })),
      );

      const result = await fetchStargazersPage("o", "r", null, "2024-01-01T00:00:00Z");
      expect(result.nextCursor).toBeNull();
    });
  });

  // ── Data transformation ────────────────────────────────────────────────────

  describe("data transformation", () => {
    it("strips @ prefix from company field", async () => {
      const edges = [makeEdge({ company: "@github" })];
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse({ edges })));
      const result = await fetchStargazersPage("o", "r", null);
      expect(result.stargazers[0].company).toBe("github");
    });

    it("keeps company without @ prefix unchanged", async () => {
      const edges = [makeEdge({ company: "GitHub Inc." })];
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse({ edges })));
      const result = await fetchStargazersPage("o", "r", null);
      expect(result.stargazers[0].company).toBe("GitHub Inc.");
    });

    it("always returns null linkedinUrl (socialAccounts removed from chunk query)", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse()));
      const result = await fetchStargazersPage("o", "r", null);
      expect(result.stargazers[0].linkedinUrl).toBeNull();
    });

    it("forwards totalCount from stargazerCount field", async () => {
      vi.mocked(fetch).mockReturnValue(
        mockFetchOk(makeGraphQLResponse({ stargazerCount: 9876 })),
      );
      const result = await fetchStargazersPage("o", "r", null);
      expect(result.totalCount).toBe(9876);
    });

    it("passes x-gh-token as Authorization header when provided", async () => {
      vi.mocked(fetch).mockReturnValue(mockFetchOk(makeGraphQLResponse()));
      await fetchStargazersPage("o", "r", null, undefined, "ghp_user_pat_123");

      const call = vi.mocked(fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer ghp_user_pat_123");
    });
  });
});

describe("fetchFollowersPage()", () => {
  const makeFollowerNode = (o: { login?: string; location?: string | null; company?: string | null } = {}) => ({
    login: o.login ?? "octocat",
    name: "The Octocat",
    bio: null,
    company: o.company !== undefined ? o.company : null,
    location: o.location !== undefined ? o.location : "San Francisco, CA",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
    createdAt: "2011-01-25T18:44:36Z",
    followers: { totalCount: 100 },
    following: { totalCount: 10 },
    repositories: { totalCount: 50 },
  });

  const makeFollowersResponse = (overrides: {
    nodes?: ReturnType<typeof makeFollowerNode>[];
    hasNextPage?: boolean;
    endCursor?: string | null;
    totalCount?: number;
  } = {}) => ({
    data: {
      user: {
        followers: {
          pageInfo: {
            hasNextPage: overrides.hasNextPage ?? false,
            endCursor: overrides.endCursor ?? null,
          },
          nodes: overrides.nodes ?? [makeFollowerNode()],
          totalCount: overrides.totalCount ?? 1,
        },
      },
    },
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns followers with correct fields", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    const page = await fetchFollowersPage("octocat", null);
    expect(page.followers).toHaveLength(1);
    expect(page.followers[0].login).toBe("octocat");
    expect(page.followers[0].location).toBe("San Francisco, CA");
    expect(page.followers[0].followers).toBe(100);
    expect(page.totalCount).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it("returns nextCursor when hasNextPage is true", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeFollowersResponse({ hasNextPage: true, endCursor: "cursor123" })),
    );
    const page = await fetchFollowersPage("octocat", null);
    expect(page.nextCursor).toBe("cursor123");
  });

  it("passes cursor variable when provided", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    await fetchFollowersPage("octocat", "cursor_abc");
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.variables.cursor).toBe("cursor_abc");
  });

  it("omits cursor variable when null", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    await fetchFollowersPage("octocat", null);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.variables.cursor).toBeUndefined();
  });

  it("throws GitHubRateLimitError on 403", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchError(403, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) }),
    );
    await expect(fetchFollowersPage("octocat", null)).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubTokenInvalidError on 401", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchError(401));
    await expect(fetchFollowersPage("octocat", null)).rejects.toBeInstanceOf(GitHubTokenInvalidError);
  });

  it("extracts quotaRemaining from x-ratelimit-remaining header", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeFollowersResponse(), { "x-ratelimit-remaining": "4800" }),
    );
    const page = await fetchFollowersPage("octocat", null);
    expect(page.quotaRemaining).toBe(4800);
  });

  it("strips leading @ from company name", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeFollowersResponse({ nodes: [makeFollowerNode({ company: "@acme" })] })),
    );
    const page = await fetchFollowersPage("octocat", null);
    expect(page.followers[0].company).toBe("acme");
  });
});

// ─── fetchRepoDependencies ────────────────────────────────────────────────────

describe("fetchRepoDependencies()", () => {
  const makeSbomResponse = (packages: Array<{
    SPDXID?: string;
    name: string;
    versionInfo?: string;
    externalRefs?: Array<{ referenceCategory: string; referenceType: string; referenceLocator: string }>;
  }>) => ({
    sbom: {
      packages,
    },
  });

  const rootPackage = {
    SPDXID: "SPDXRef-DOCUMENT",
    name: "github/my-repo",
    // No purl externalRef — this is the self-package
    externalRefs: [],
  };

  const npmReact = {
    SPDXID: "SPDXRef-Package-npm-react",
    name: "npm:react",
    versionInfo: "18.2.0",
    externalRefs: [
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/react@18.2.0" },
    ],
  };

  const pipRequests = {
    SPDXID: "SPDXRef-Package-pip-requests",
    name: "pip:requests",
    versionInfo: "2.28.0",
    externalRefs: [
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:pip/requests@2.28.0" },
    ],
  };

  const cargoSerde = {
    SPDXID: "SPDXRef-Package-cargo-serde",
    name: "cargo:serde",
    versionInfo: "1.0.0",
    externalRefs: [
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:cargo/serde@1.0.0" },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses ecosystem, name, and version from purl externalRefs", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeSbomResponse([rootPackage, npmReact, pipRequests, cargoSerde])),
    );
    const result = await fetchRepoDependencies("o", "r");
    expect(result.disabled).toBe(false);
    expect(result.dependencies).toHaveLength(3);
    expect(result.dependencies[0]).toEqual({ name: "react", ecosystem: "npm", version: "18.2.0" });
    expect(result.dependencies[1]).toEqual({ name: "requests", ecosystem: "pip", version: "2.28.0" });
    expect(result.dependencies[2]).toEqual({ name: "serde", ecosystem: "cargo", version: "1.0.0" });
    expect(result.totalCount).toBe(3);
  });

  it("filters out the root SPDX package (no purl externalRef)", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeSbomResponse([rootPackage, npmReact])),
    );
    const result = await fetchRepoDependencies("o", "r");
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0].name).toBe("react");
  });

  it("deduplicates packages with the same ecosystem and name", async () => {
    const reactDuplicate = {
      ...npmReact,
      SPDXID: "SPDXRef-Package-npm-react-dev",
      versionInfo: "18.3.0",
      externalRefs: [
        { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/react@18.3.0" },
      ],
    };
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeSbomResponse([rootPackage, npmReact, reactDuplicate])),
    );
    const result = await fetchRepoDependencies("o", "r");
    expect(result.dependencies).toHaveLength(1);
    // First occurrence wins
    expect(result.dependencies[0].version).toBe("18.2.0");
  });

  it("returns disabled:true gracefully on 403 when quota is not exhausted", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchError(403, { "x-ratelimit-remaining": "4999" }),
    );
    const result = await fetchRepoDependencies("o", "r");
    expect(result.disabled).toBe(true);
    expect(result.dependencies).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("returns disabled:true gracefully on 404", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchError(404));
    const result = await fetchRepoDependencies("o", "r");
    expect(result.disabled).toBe(true);
    expect(result.dependencies).toHaveLength(0);
  });

  it("throws GitHubRateLimitError on 403 when quota is zero", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchError(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) }),
    );
    await expect(fetchRepoDependencies("o", "r")).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubRateLimitError on 429", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchError(429, { "retry-after": "30" }),
    );
    await expect(fetchRepoDependencies("o", "r")).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubTokenInvalidError on 401", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchError(401));
    await expect(fetchRepoDependencies("o", "r")).rejects.toBeInstanceOf(GitHubTokenInvalidError);
  });

  it("throws a generic Error for unexpected non-ok status", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchError(500));
    await expect(fetchRepoDependencies("o", "r")).rejects.toThrow("GitHub SBOM API error: 500");
  });

  it("extracts quotaRemaining from x-ratelimit-remaining header", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeSbomResponse([rootPackage, npmReact]), { "x-ratelimit-remaining": "3500" }),
    );
    const result = await fetchRepoDependencies("o", "r");
    expect(result.quotaRemaining).toBe(3500);
  });

  it("returns null quotaRemaining when header is absent", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeSbomResponse([rootPackage, npmReact])));
    const result = await fetchRepoDependencies("o", "r");
    expect(result.quotaRemaining).toBeNull();
  });
});
