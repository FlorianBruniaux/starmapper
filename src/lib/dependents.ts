// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Dependents data layer: fetches repos that depend on a given GitHub package
// using the ecosyste.ms API (no API key, ToS-clean, multi-ecosystem).
//
// Primary endpoint: repos.ecosyste.ms/api/v1/usage/{ecosystem}/{package}/dependencies
// Package lookup:   packages.ecosyste.ms/api/v1/packages/lookup?repository_url=...
//
// The server-side `sort` param is not supported on the usage endpoint (returns 500).
// Sorting is performed client-side via sortDependents().

const PACKAGES_API = "https://packages.ecosyste.ms/api/v1";
const REPOS_API = "https://repos.ecosyste.ms/api/v1";
const USER_AGENT = "StarMapper/0.6 (https://starmapper.bruniaux.com)";
export const DEPENDENTS_MAX_PAGES = 5; // 500 rows max; keeps fetch time < 5s
const PER_PAGE = 100;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DependentRow = {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  ecosystem: string;
  packageName: string;
  requirement: string | null;
  isDirect: boolean;
  htmlUrl: string;
};

export type ResolvedPackage = {
  name: string;
  ecosystem: string;
  registry: string;
  dependentReposCount: number;
};

export type DependentsResult = {
  source: "ecosystems";
  packages: ResolvedPackage[];
  dependents: DependentRow[];
  totalCount: number;
  truncated: boolean;
  fetchedAt: string;
};

export type SortBy = "stars" | "forks" | "name";

// ---------------------------------------------------------------------------
// Raw ecosyste.ms shapes (internal)
// ---------------------------------------------------------------------------

type EcoPackage = {
  name: string;
  ecosystem: string;
  dependent_repos_count: number;
  registry_url?: string;
};

type EcoDepRow = {
  package_name: string;
  ecosystem: string;
  requirements: string | null;
  direct: boolean;
  kind: string;
  repository: {
    full_name: string;
    owner: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    html_url: string;
    archived?: boolean;
  } | null;
};

// ---------------------------------------------------------------------------
// Package resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a GitHub repo to its published packages via ecosyste.ms lookup.
 * Returns packages sorted by dependent_repos_count desc, one per ecosystem.
 */
export const resolvePackages = async (
  owner: string,
  repo: string,
): Promise<ResolvedPackage[]> => {
  let res: Response;
  try {
    res = await fetch(
      `${PACKAGES_API}/packages/lookup?repository_url=https://github.com/${owner}/${repo}`,
      {
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const raw = await res.json() as unknown;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Dedup by ecosystem: keep highest dependent_repos_count per ecosystem
  const byEcosystem = new Map<string, EcoPackage>();
  for (const pkg of raw as EcoPackage[]) {
    if (typeof pkg.name !== "string" || typeof pkg.ecosystem !== "string") continue;
    const existing = byEcosystem.get(pkg.ecosystem);
    if (!existing || (pkg.dependent_repos_count ?? 0) > existing.dependent_repos_count) {
      byEcosystem.set(pkg.ecosystem, pkg);
    }
  }

  return [...byEcosystem.values()]
    .sort((a, b) => (b.dependent_repos_count ?? 0) - (a.dependent_repos_count ?? 0))
    .map((pkg) => ({
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      registry: extractHostname(pkg.registry_url ?? ""),
      dependentReposCount: pkg.dependent_repos_count ?? 0,
    }));
};

// ---------------------------------------------------------------------------
// Dependency fetching
// ---------------------------------------------------------------------------

/**
 * Fetches repos that use a package, paginating up to maxPages × PER_PAGE rows.
 * Deduplicates by full_name within the call.
 */
export const fetchDependentPages = async (
  ecosystem: string,
  packageName: string,
  maxPages = DEPENDENTS_MAX_PAGES,
): Promise<{ rows: DependentRow[]; truncated: boolean }> => {
  const rows: DependentRow[] = [];
  const seen = new Set<string>();
  let page = 1;
  let hasNext = true;

  while (hasNext && page <= maxPages) {
    let res: Response;
    try {
      res = await fetch(
        `${REPOS_API}/usage/${encodeURIComponent(ecosystem)}/${encodeURIComponent(packageName)}/dependencies?per_page=${PER_PAGE}&page=${page}`,
        { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
      );
    } catch {
      break;
    }
    if (!res.ok) break;

    const raw = await res.json() as unknown;
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const row of raw as EcoDepRow[]) {
      const meta = row.repository;
      if (!meta?.full_name) continue;
      if (seen.has(meta.full_name)) continue;
      seen.add(meta.full_name);

      const parts = meta.full_name.split("/");
      rows.push({
        owner: parts[0] ?? meta.owner,
        repo: parts[1] ?? meta.full_name,
        fullName: meta.full_name,
        description: meta.description,
        stars: meta.stargazers_count ?? 0,
        forks: meta.forks_count ?? 0,
        language: meta.language,
        ecosystem,
        packageName: row.package_name,
        requirement: row.requirements,
        isDirect: row.direct,
        htmlUrl: meta.html_url,
      });
    }

    const link = res.headers.get("link") ?? "";
    hasNext = link.includes('rel="next"');
    page++;
  }

  return { rows, truncated: hasNext && page > maxPages };
};

/**
 * Top-level fetch: resolves packages, fetches dependents for the primary one,
 * returns a DependentsResult ready to persist.
 */
export const fetchDependents = async (
  owner: string,
  repo: string,
  maxPages = DEPENDENTS_MAX_PAGES,
): Promise<DependentsResult> => {
  const packages = await resolvePackages(owner, repo);

  if (packages.length === 0) {
    return {
      source: "ecosystems",
      packages: [],
      dependents: [],
      totalCount: 0,
      truncated: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const primary = packages[0]!;
  const { rows, truncated } = await fetchDependentPages(primary.ecosystem, primary.name, maxPages);
  const totalCount = packages.reduce((sum, p) => sum + p.dependentReposCount, 0);

  return {
    source: "ecosystems",
    packages,
    dependents: rows,
    totalCount,
    truncated,
    fetchedAt: new Date().toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

/** Returns a sorted copy — does not mutate the input array. */
export const sortDependents = (rows: DependentRow[], by: SortBy): DependentRow[] => {
  const copy = [...rows];
  if (by === "stars") return copy.sort((a, b) => b.stars - a.stars);
  if (by === "forks") return copy.sort((a, b) => b.forks - a.forks);
  return copy.sort((a, b) => a.fullName.localeCompare(b.fullName));
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const extractHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
