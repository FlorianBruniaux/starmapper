// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mock prisma ──────────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (login: string) =>
  new NextRequest(`http://localhost/api/explore/user-repos?login=${encodeURIComponent(login)}`);

const RAW_REPOS = [
  { name: "myrepo", full_name: "alice/myrepo", description: "desc", stargazers_count: 500, language: "TypeScript", html_url: "https://github.com/alice/myrepo", fork: false },
  { name: "forked", full_name: "alice/forked", description: null, stargazers_count: 100, language: "Go", html_url: "https://github.com/alice/forked", fork: true },
];

const EXPECTED_REPOS = [
  { name: "myrepo", fullName: "alice/myrepo", description: "desc", stars: 500, language: "TypeScript", url: "https://github.com/alice/myrepo" },
];

const mockGitHubSuccess = () => {
  vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("/repos?")) {
      return new Response(JSON.stringify(RAW_REPOS), { status: 200 });
    }
    return new Response(JSON.stringify({ public_repos: 42 }), { status: 200 });
  });
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/explore/user-repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("DB hit fresh → returns DB data without calling GitHub", async () => {
    const freshDate = new Date(Date.now() - 60_000); // 1 min ago
    mockFindUnique.mockResolvedValue({
      topRepos: EXPECTED_REPOS,
      topReposFetchedAt: freshDate,
      publicRepos: 10,
    });
    const fetchSpy = vi.spyOn(global, "fetch");

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(body.repos).toEqual(EXPECTED_REPOS);
    expect(body.totalRepos).toBe(10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DB miss (user unknown) → calls GitHub, does NOT write DB", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockGitHubSuccess();

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(body.repos).toEqual(EXPECTED_REPOS);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("DB stale (> 7d) → calls GitHub and updates DB", async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    mockFindUnique.mockResolvedValue({
      topRepos: [],
      topReposFetchedAt: staleDate,
      publicRepos: 0,
    });
    mockGitHubSuccess();
    mockUpdate.mockResolvedValue({});

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(body.repos).toEqual(EXPECTED_REPOS);
    // totalRepos comes from GitHub (42), not stale DB value (0)
    expect(body.totalRepos).toBe(42);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { login: "alice" },
        data: expect.objectContaining({ topRepos: EXPECTED_REPOS }),
      }),
    );
  });

  it("GitHub 404 with user in DB → writes empty topRepos and returns 404", async () => {
    mockFindUnique.mockResolvedValue({ topRepos: null, topReposFetchedAt: null, publicRepos: 0 });
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    mockUpdate.mockResolvedValue({});

    const { GET } = await import("./route");
    const res = await GET(makeReq("deleted-user"));

    expect(res.status).toBe(404);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { login: "deleted-user" },
        data: expect.objectContaining({ topRepos: [] }),
      }),
    );
  });

  it("userData call fails (403) + dbUser.publicRepos = 0 → totalRepos = repos.length, publicRepos persisted", async () => {
    mockFindUnique.mockResolvedValue({ topRepos: null, topReposFetchedAt: null, publicRepos: 0 });
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/repos?")) {
        return new Response(JSON.stringify(RAW_REPOS), { status: 200 });
      }
      return new Response(null, { status: 403 }); // /users/:login rate-limited
    });
    mockUpdate.mockResolvedValue({});

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repos).toEqual(EXPECTED_REPOS);
    // totalRepos must be >= repos.length — never 0 when repos returned
    expect(body.totalRepos).toBe(EXPECTED_REPOS.length);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicRepos: EXPECTED_REPOS.length }),
      }),
    );
  });

  it("fresh DB hit with publicRepos = 0 but non-empty topRepos → totalRepos = topRepos.length", async () => {
    const freshDate = new Date(Date.now() - 60_000);
    mockFindUnique.mockResolvedValue({
      topRepos: EXPECTED_REPOS,
      topReposFetchedAt: freshDate,
      publicRepos: 0, // never-updated stale value
    });
    const fetchSpy = vi.spyOn(global, "fetch");

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(body.repos).toEqual(EXPECTED_REPOS);
    expect(body.totalRepos).toBe(EXPECTED_REPOS.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DB down → falls back to GitHub without throwing", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection failed"));
    mockGitHubSuccess();

    const { GET } = await import("./route");
    const res = await GET(makeReq("alice"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repos).toEqual(EXPECTED_REPOS);
  });
});
