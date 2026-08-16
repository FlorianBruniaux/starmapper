// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindFirst = vi.fn();
const mockBadgeFindMany = vi.fn();
const mockStarFindMany = vi.fn();
const mockStarCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: { findFirst: (...a: unknown[]) => mockUserFindFirst(...a) },
    badgeCache: { findMany: (...a: unknown[]) => mockBadgeFindMany(...a) },
    starEvent: {
      findMany: (...a: unknown[]) => mockStarFindMany(...a),
      count: (...a: unknown[]) => mockStarCount(...a),
    },
  },
}));

import { fetchProfile } from "@/lib/profile-query";

const badgeRow = (owner: string, repo: string, totalCount = 100) => ({
  owner,
  repo,
  totalCount,
  mappedCount: 50,
  language: "TypeScript",
});

describe("fetchProfile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUserFindFirst.mockResolvedValue(null);
    mockBadgeFindMany.mockResolvedValue([]);
    mockStarFindMany.mockResolvedValue([]);
    mockStarCount.mockResolvedValue(0);
  });

  // The discriminated union exists so the route can still tell 400 from 404. Collapsing it
  // to `ProfileResponse | null` would make a malformed login indistinguishable from a
  // missing one, and /profile/{bad login} has to stay a 400.
  it("returns invalid_params/400 for a malformed login", async () => {
    const result = await fetchProfile("bad login!");
    expect(result).toEqual({ ok: false, error: "invalid_params", status: 400 });
    expect(mockUserFindFirst).not.toHaveBeenCalled();
  });

  it("returns not_found/404 when neither github_user nor badge_cache knows the login", async () => {
    const result = await fetchProfile("ghost");
    expect(result).toEqual({ ok: false, error: "not_found", status: 404 });
  });

  it("falls back to a partial profile for a repo owner who is not a tracked stargazer", async () => {
    mockBadgeFindMany.mockResolvedValue([badgeRow("OctoCat", "hello-world", 900)]);
    const result = await fetchProfile("octocat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.partial).toBe(true);
    // Canonical casing comes from badge_cache, not from the requested login
    expect(result.profile.login).toBe("OctoCat");
    expect(result.profile.ownedRepos).toHaveLength(1);
    expect(result.profile.starredRepos).toHaveLength(0);
  });

  it("rounds lat/lng to 2 decimals on the full profile path", async () => {
    mockUserFindFirst.mockResolvedValue({
      login: "octocat",
      name: "Octo",
      company: null,
      location: "Paris",
      followers: 10,
      publicRepos: 3,
      lat: 48.856614,
      lng: 2.3522219,
      countryNormalized: "France",
      cityNormalized: "Paris",
      languages: ["TypeScript"],
      linkedinUrl: null,
    });
    const result = await fetchProfile("octocat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.partial).toBe(false);
    expect(result.profile.lat).toBe(48.86);
    expect(result.profile.lng).toBe(2.35);
  });

  it("drops starred events that have no badge_cache row", async () => {
    mockUserFindFirst.mockResolvedValue({
      login: "octocat",
      name: null,
      company: null,
      location: null,
      followers: 0,
      publicRepos: 0,
      lat: null,
      lng: null,
      countryNormalized: null,
      cityNormalized: null,
      languages: [],
      linkedinUrl: null,
    });
    mockStarFindMany.mockResolvedValue([
      { owner: "vercel", repo: "next.js", starredAt: new Date("2026-01-01T00:00:00Z") },
      { owner: "unknown", repo: "repo", starredAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    mockStarCount.mockResolvedValue(2);
    // First call = owned repos (none), second = badge enrichment for starred events
    mockBadgeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([badgeRow("vercel", "next.js")]);

    const result = await fetchProfile("octocat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // starredCount reflects every event, starredRepos only the enrichable ones
    expect(result.profile.starredCount).toBe(2);
    expect(result.profile.starredRepos).toHaveLength(1);
    expect(result.profile.starredRepos[0].repo).toBe("next.js");
    expect(result.profile.starredRepos[0].starredAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
