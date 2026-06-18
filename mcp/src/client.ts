// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper HTTP client — wraps all API endpoints used by the MCP tools.
// BASE_URL defaults to the production StarMapper instance.
// Override STARMAPPER_BASE_URL env var for local dev or self-hosted instances.

export const BASE_URL = process.env.STARMAPPER_BASE_URL ?? "https://starmapper.bruniaux.com";

const SM_COOKIE = "sm-token";
const GH_TOKEN = process.env.GITHUB_TOKEN ?? null;

export const hasGhToken = (): boolean => GH_TOKEN !== null;

export const fetchSmToken = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${BASE_URL}/`, {
      headers: { "User-Agent": "starmapper-mcp/0.1.0", Accept: "text/html" },
      redirect: "follow",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`${SM_COOKIE}=([^;]+)`));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`StarMapper API error ${res.status} on GET ${path}`);
  return res.json() as Promise<T>;
};

// --- Response types (minimal subset needed by MCP tools) ---

export type RepoStats = {
  totalStars: number;
  mappedCount: number;
  mappingRate: number;
  avgFollowers: number;
  countryCount: number;
  topCountries: [string, number][];
  topCities: [string, number][];
  organic: {
    score: number | null;
    tier: string;
    computedAt: string | null;
  } | null;
};

export type OrganicScore = {
  score: number | null;
  tier: string;
  tierLabel: string;
  computedAt: string | null;
  signals: {
    forkRatio: number | null;
    watcherRatio: number | null;
    zeroFollowerPct: number | null;
    releasesCount: number | null;
    sampleSize: number;
  };
  weights: {
    fork_ratio: number;
    watcher_ratio: number;
    zero_follower_pct: number;
    releases_count: number;
  };
  activeSignals: string[];
  reasons: string[];
  corpusAccuracy: number;
};

export type VelocityItem = {
  country: string;
  stars30d: number;
  stars90d: number;
  total: number;
  trend: "rising" | "new" | "stable" | "declining";
  ratio: number;
};

export type InfluentialUser = {
  login: string;
  name: string | null;
  followers: number;
  location: string | null;
  profileUrl: string;
  avatarUrl: string;
};

export type ChunkResult = {
  points: { login: string; lat: number; lng: number }[];
  unmapped: { login: string; location: string | null }[];
  nextCursor: string | null;
  totalCount: number;
};

// --- Fetch functions ---

export const fetchRepoStats = (owner: string, repo: string): Promise<RepoStats> =>
  get<RepoStats>(`/api/stats/${owner}/${repo}`);

export const fetchOrganicScore = (owner: string, repo: string): Promise<OrganicScore> =>
  get<OrganicScore>(`/api/mcp/organic-score/${owner}/${repo}`);

export const fetchVelocity = (owner: string, repo: string): Promise<{ items: VelocityItem[]; timedOut?: boolean }> =>
  get(`/api/stats/${owner}/${repo}/geo-velocity`);

export const fetchInfluentialStargazers = (
  owner: string,
  repo: string,
  minFollowers: number,
): Promise<{ users: InfluentialUser[]; total: number; minFollowers: number }> =>
  get(`/api/mcp/influential/${owner}/${repo}?minFollowers=${minFollowers}`);

export type CacheStatus = {
  cached: boolean;
  scannedAt: string | null;
  totalCount: number | null;
  mappedCount: number | null;
};

export type TrendingRepo = {
  owner: string;
  repo: string;
  stars7d: number;
  stars30d: number;
  stars90d: number;
  language: string | null;
  totalCount: number;
  mappedCount: number;
};

export type RepoItem = {
  owner: string;
  repo: string;
  mappedCount: number;
  countryCount: number;
  totalCount: number;
  mappedPercent: number;
};

export const fetchCacheStatus = (owner: string, repo: string): Promise<CacheStatus> =>
  get<CacheStatus>(`/api/mcp/cache-status/${owner}/${repo}`);

export const fetchTrending = (): Promise<{ repos: TrendingRepo[]; meta: { total: number } }> =>
  get(`/api/trending/repos`);

export const fetchListRepos = (limit: number): Promise<{ repos: RepoItem[]; total: number }> =>
  get(`/api/repos?limit=${limit}`);

export type McpDependentsResponse = {
  packages: Array<{ name: string; ecosystem: string; dependentReposCount: number }>;
  topDependents: Array<{
    fullName: string;
    stars: number;
    forks: number;
    language: string | null;
    ecosystem: string;
    packageName: string;
    htmlUrl: string;
  }>;
  totalCount: number;
  shownCount: number;
  truncated: boolean;
  fetchedAt: string;
  mapUrl: string;
};

export const fetchDependentsMcp = (owner: string, repo: string): Promise<McpDependentsResponse> =>
  get<McpDependentsResponse>(`/api/mcp/dependents/${owner}/${repo}`);

// --- New response types (mirror of server Mcp*Response types — field names must stay in sync) ---
// Source: src/app/api/mcp/contributors/[owner]/[repo]/route.ts
export type McpContributorsResponse = {
  contributors: Array<{
    login: string;
    contributions: number;
    location: string | null;
    profileUrl: string;
  }>;
  shownCount: number;
  hasMore: boolean;
  computing: boolean;
  fetchedAt: string;
  mapUrl: string;
};

// Source: src/app/api/mcp/followers/[login]/route.ts
export type McpFollowersResponse = {
  login: string;
  followers: Array<{
    login: string;
    name: string | null;
    followers: number;
    company: string | null;
    location: string | null;
    profileUrl: string;
  }>;
  shownCount: number;
  totalCount: number;
  truncated: boolean;
  fetchedAt: string;
};

// Source: src/app/api/mcp/country-stats/route.ts
export type McpGlobalCountryStatsResponse = {
  countries: Array<{ name: string; count: number; slug: string }>;
  totalCountries: number;
  totalStargazers: number;
  generatedAt: string;
};

// Source: src/app/api/mcp/dependencies/[owner]/[repo]/route.ts
export type McpDependenciesResponse = {
  dependencies: Array<{
    name: string;
    ecosystem: string | null;
    version: string | null;
  }>;
  totalCount: number;
  shownCount: number;
  truncated: boolean;
  disabled: boolean;
  fetchedAt: string;
};

export const fetchContributorsMcp = (
  owner: string,
  repo: string,
  withLocations = false,
): Promise<McpContributorsResponse> =>
  get<McpContributorsResponse>(
    `/api/mcp/contributors/${owner}/${repo}${withLocations ? "?withLocations=1" : ""}`,
  );

export const fetchFollowersMcp = (login: string): Promise<McpFollowersResponse> =>
  get<McpFollowersResponse>(`/api/mcp/followers/${login}`);

export const fetchGlobalCountryStats = (): Promise<McpGlobalCountryStatsResponse> =>
  get<McpGlobalCountryStatsResponse>(`/api/mcp/country-stats`);

export const fetchDependenciesMcp = (owner: string, repo: string): Promise<McpDependenciesResponse> =>
  get<McpDependenciesResponse>(`/api/mcp/dependencies/${owner}/${repo}`);

export const triggerChunk = async (
  owner: string,
  repo: string,
  cursor: string | null,
  smToken?: string | null,
): Promise<ChunkResult> => {
  const body = cursor ? { owner, repo, cursor } : { owner, repo };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (smToken) headers["Cookie"] = `${SM_COOKIE}=${smToken}`;
  if (GH_TOKEN) headers["x-gh-token"] = GH_TOKEN;
  const res = await fetch(`${BASE_URL}/api/chunk`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`StarMapper chunk error ${res.status}`);
  return res.json() as Promise<ChunkResult>;
};
