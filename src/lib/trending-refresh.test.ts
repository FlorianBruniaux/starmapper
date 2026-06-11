// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFetchPage = vi.fn();
vi.mock("@/lib/github", () => ({
  fetchStargazersPage: (...args: unknown[]) => mockFetchPage(...args),
  GitHubRateLimitError: class extends Error {},
}));

const mockBulkInsertUsersMinimal = vi.fn().mockResolvedValue(true);
const mockBulkUpsertStarEvents = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/user-cache", () => ({
  bulkInsertUsersMinimal: (...args: unknown[]) => mockBulkInsertUsersMinimal(...args),
  bulkUpsertStarEvents: (...args: unknown[]) => mockBulkUpsertStarEvents(...args),
}));

const mockQueryRaw = vi.fn();
const mockUpsert = vi.fn().mockResolvedValue(undefined);
const mockBadgeUpsert = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    trendingRefresh: { upsert: (...args: unknown[]) => mockUpsert(...args) },
    badgeCache: { upsert: (...args: unknown[]) => mockBadgeUpsert(...args) },
  },
}));

import {
  refreshRepoStarEvents,
  selectRefreshTargets,
  recordRefresh,
  TRENDING_WINDOW_DAYS,
} from "@/lib/trending-refresh";

const healthOk = { ok: true as const, usagePct: 10 };

const makeStargazer = (login: string, starredAt: string) => ({
  login,
  name: null,
  bio: null,
  company: null,
  location: "Paris",
  followers: 1,
  following: 0,
  publicRepos: 2,
  accountCreatedAt: "2020-01-01T00:00:00Z",
  avatarUrl: "https://example.com/a.png",
  starredAt,
  linkedinUrl: null,
});

const page = (stargazers: ReturnType<typeof makeStargazer>[], nextCursor: string | null) => ({
  totalCount: 1000,
  nextCursor,
  stargazers,
  quotaRemaining: 4999,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshRepoStarEvents", () => {
  it("normalizes owner/repo to lowercase for fetch and star_events", async () => {
    mockFetchPage.mockResolvedValueOnce(page([makeStargazer("alice", "2026-06-09T00:00:00Z")], null));

    const res = await refreshRepoStarEvents({ owner: "FreeCodeCamp", repo: "FreeCodeCamp" }, healthOk);

    expect(mockFetchPage).toHaveBeenCalledWith("freecodecamp", "freecodecamp", null, expect.any(String));
    const eventsArg = mockBulkUpsertStarEvents.mock.calls[0][0];
    expect(eventsArg[0]).toMatchObject({ login: "alice", owner: "freecodecamp", repo: "freecodecamp" });
    expect(res.eventsAdded).toBe(1);
  });

  it("passes a `since` timestamp inside the configured window", async () => {
    mockFetchPage.mockResolvedValueOnce(page([], null));

    await refreshRepoStarEvents({ owner: "o", repo: "r" }, healthOk);

    const sinceArg = mockFetchPage.mock.calls[0][3] as string;
    const sinceMs = new Date(sinceArg).getTime();
    const expectedMs = Date.now() - TRENDING_WINDOW_DAYS * 86_400_000;
    // Within a 5s tolerance of "now minus window".
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(5000);
  });

  it("paginates until nextCursor is null and accumulates events", async () => {
    mockFetchPage
      .mockResolvedValueOnce(page([makeStargazer("a", "2026-06-09T00:00:00Z")], "cursor-1"))
      .mockResolvedValueOnce(page([makeStargazer("b", "2026-06-08T00:00:00Z")], null));

    const res = await refreshRepoStarEvents({ owner: "o", repo: "r" }, healthOk);

    expect(mockFetchPage).toHaveBeenCalledTimes(2);
    expect(mockFetchPage.mock.calls[1][2]).toBe("cursor-1");
    expect(res.eventsAdded).toBe(2);
    expect(res.pages).toBe(2);
  });

  it("inserts users before star_events (FK ordering)", async () => {
    mockFetchPage.mockResolvedValueOnce(page([makeStargazer("a", "2026-06-09T00:00:00Z")], null));
    const order: string[] = [];
    mockBulkInsertUsersMinimal.mockImplementationOnce(async () => {
      order.push("users");
      return true;
    });
    mockBulkUpsertStarEvents.mockImplementationOnce(async () => {
      order.push("events");
    });

    await refreshRepoStarEvents({ owner: "o", repo: "r" }, healthOk);

    expect(order).toEqual(["users", "events"]);
  });

  it("stops at the page cap to bound GitHub quota", async () => {
    // Always return a next cursor — only the MAX_PAGES cap can stop the loop.
    mockFetchPage.mockResolvedValue(page([makeStargazer("a", "2026-06-09T00:00:00Z")], "next"));

    const res = await refreshRepoStarEvents({ owner: "o", repo: "r" }, healthOk);

    expect(res.pages).toBe(20);
    expect(mockFetchPage).toHaveBeenCalledTimes(20);
  });

  it("skips writes when no stargazers are returned", async () => {
    mockFetchPage.mockResolvedValueOnce(page([], null));

    const res = await refreshRepoStarEvents({ owner: "o", repo: "r" }, healthOk);

    expect(mockBulkInsertUsersMinimal).not.toHaveBeenCalled();
    expect(mockBulkUpsertStarEvents).not.toHaveBeenCalled();
    expect(res.eventsAdded).toBe(0);
  });

  it("upserts badge_cache totalCount without clobbering mapped/country counts", async () => {
    mockFetchPage.mockResolvedValueOnce(page([makeStargazer("a", "2026-06-09T00:00:00Z")], null));

    await refreshRepoStarEvents({ owner: "Vercel", repo: "Next.js" }, healthOk);

    expect(mockBadgeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner_repo: { owner: "vercel", repo: "next.js" } },
        update: { totalCount: 1000 },
        create: { owner: "vercel", repo: "next.js", totalCount: 1000, mappedCount: 0, countryCount: 0 },
      }),
    );
  });
});

describe("selectRefreshTargets", () => {
  it("returns the rows from the candidate query", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ owner: "o", repo: "r" }]);
    const targets = await selectRefreshTargets(50);
    expect(targets).toEqual([{ owner: "o", repo: "r" }]);
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });
});

describe("recordRefresh", () => {
  it("upserts the ledger with normalized keys", async () => {
    await recordRefresh({ owner: "Vercel", repo: "Next.js" }, 7);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner_repo: { owner: "vercel", repo: "next.js" } },
        update: expect.objectContaining({ eventsAdded: 7 }),
        create: expect.objectContaining({ owner: "vercel", repo: "next.js", eventsAdded: 7 }),
      }),
    );
  });
});
