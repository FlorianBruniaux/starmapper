// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sortDependents,
  fetchDependentPages,
  resolvePackages,
  fetchDependents,
} from "./dependents";
import type { DependentRow } from "./dependents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<DependentRow> = {}): DependentRow => ({
  owner: "owner",
  repo: "repo",
  fullName: "owner/repo",
  description: null,
  stars: 100,
  forks: 10,
  language: "TypeScript",
  ecosystem: "npm",
  packageName: "pkg",
  requirement: "^1.0.0",
  isDirect: true,
  htmlUrl: "https://github.com/owner/repo",
  ...overrides,
});

// ---------------------------------------------------------------------------
// sortDependents
// ---------------------------------------------------------------------------

describe("sortDependents", () => {
  it("sorts by stars descending", () => {
    const rows = [makeRow({ stars: 50 }), makeRow({ stars: 200 }), makeRow({ stars: 10 })];
    const sorted = sortDependents(rows, "stars");
    expect(sorted.map((r) => r.stars)).toEqual([200, 50, 10]);
  });

  it("sorts by forks descending", () => {
    const rows = [makeRow({ forks: 5 }), makeRow({ forks: 99 }), makeRow({ forks: 1 })];
    const sorted = sortDependents(rows, "forks");
    expect(sorted.map((r) => r.forks)).toEqual([99, 5, 1]);
  });

  it("sorts by name alphabetically ascending", () => {
    const rows = [
      makeRow({ fullName: "z/repo" }),
      makeRow({ fullName: "a/repo" }),
      makeRow({ fullName: "m/repo" }),
    ];
    const sorted = sortDependents(rows, "name");
    expect(sorted.map((r) => r.fullName)).toEqual(["a/repo", "m/repo", "z/repo"]);
  });

  it("does not mutate the input array", () => {
    const rows = [makeRow({ stars: 10 }), makeRow({ stars: 100 })];
    const original = [...rows];
    sortDependents(rows, "stars");
    expect(rows[0]!.stars).toBe(original[0]!.stars);
  });

  it("handles empty array", () => {
    expect(sortDependents([], "stars")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolvePackages — fetch mocked
// ---------------------------------------------------------------------------

describe("resolvePackages", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty array when fetch fails", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network error"));
    const result = await resolvePackages("owner", "repo");
    expect(result).toEqual([]);
  });

  it("returns empty array on non-ok response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    const result = await resolvePackages("owner", "repo");
    expect(result).toEqual([]);
  });

  it("deduplicates packages by ecosystem, keeping highest dependent_repos_count", async () => {
    const rawPackages = [
      { name: "pkg-a", ecosystem: "npm", dependent_repos_count: 100, registry_url: "https://npmjs.com/package/pkg-a" },
      { name: "pkg-b", ecosystem: "npm", dependent_repos_count: 500, registry_url: "https://npmjs.com/package/pkg-b" },
      { name: "pkg-c", ecosystem: "pypi", dependent_repos_count: 200, registry_url: "https://pypi.org/project/pkg-c" },
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(rawPackages), { status: 200 }),
    );
    const result = await resolvePackages("owner", "repo");
    expect(result).toHaveLength(2);
    // npm: pkg-b (500 > 100), pypi: pkg-c (200)
    expect(result[0]!.name).toBe("pkg-b");
    expect(result[0]!.dependentReposCount).toBe(500);
    expect(result[1]!.ecosystem).toBe("pypi");
  });

  it("sorts packages by dependent_repos_count descending", async () => {
    const rawPackages = [
      { name: "low", ecosystem: "npm", dependent_repos_count: 10 },
      { name: "high", ecosystem: "pypi", dependent_repos_count: 1000 },
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(rawPackages), { status: 200 }),
    );
    const result = await resolvePackages("owner", "repo");
    expect(result[0]!.name).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// fetchDependentPages — fetch mocked
// ---------------------------------------------------------------------------

describe("fetchDependentPages", () => {
  afterEach(() => vi.restoreAllMocks());

  const makeApiRow = (fullName: string, stars = 50) => ({
    package_name: "express",
    ecosystem: "npm",
    requirements: "^4.0.0",
    direct: true,
    kind: "runtime",
    repository: {
      full_name: fullName,
      owner: fullName.split("/")[0],
      description: "A repo",
      stargazers_count: stars,
      forks_count: 5,
      language: "JavaScript",
      html_url: `https://github.com/${fullName}`,
    },
  });

  it("returns rows from a single page", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([makeApiRow("user/app", 200)]), {
        status: 200,
        headers: { link: "" },
      }),
    );
    const { rows, truncated } = await fetchDependentPages("npm", "express", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe("user/app");
    expect(rows[0]!.stars).toBe(200);
    expect(truncated).toBe(false);
  });

  it("deduplicates by fullName across pages", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    // Page 1 with "next" link
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([makeApiRow("user/app")]), {
        status: 200,
        headers: { link: '<http://example.com?page=2>; rel="next"' },
      }),
    );
    // Page 2 returns same repo (duplicate)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([makeApiRow("user/app"), makeApiRow("user/other")]), {
        status: 200,
        headers: { link: "" },
      }),
    );
    const { rows } = await fetchDependentPages("npm", "express", 2);
    expect(rows).toHaveLength(2);
    const names = rows.map((r) => r.fullName);
    expect(names).toContain("user/app");
    expect(names).toContain("user/other");
  });

  it("marks truncated=true when maxPages reached and more pages exist", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([makeApiRow("user/app")]), {
        status: 200,
        headers: { link: '<http://example.com?page=2>; rel="next"' },
      }),
    );
    const { truncated } = await fetchDependentPages("npm", "express", 1);
    expect(truncated).toBe(true);
  });

  it("handles non-ok response gracefully", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    );
    const { rows, truncated } = await fetchDependentPages("npm", "express", 1);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("skips rows with missing repository", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([{ package_name: "x", ecosystem: "npm", requirements: null, direct: true, kind: "runtime", repository: null }]), {
        status: 200,
        headers: { link: "" },
      }),
    );
    const { rows } = await fetchDependentPages("npm", "express", 1);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchDependents — integration (both calls mocked)
// ---------------------------------------------------------------------------

describe("fetchDependents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns no_package result when lookup returns empty array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const result = await fetchDependents("user", "app");
    expect(result.packages).toEqual([]);
    expect(result.dependents).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("uses primary package (highest dependent_repos_count) for fetching", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    // Lookup returns two packages: pypi (200 dep repos) + npm (1000 dep repos)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        { name: "my-pkg", ecosystem: "npm", dependent_repos_count: 1000 },
        { name: "my-pkg-py", ecosystem: "pypi", dependent_repos_count: 200 },
      ]), { status: 200 }),
    );
    // Dependency fetch (should be called with npm/my-pkg)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200, headers: { link: "" } }),
    );
    const result = await fetchDependents("user", "lib");
    expect(result.packages[0]!.name).toBe("my-pkg");
    expect(result.packages[0]!.ecosystem).toBe("npm");
    expect(result.totalCount).toBe(1200); // 1000 + 200
  });
});
