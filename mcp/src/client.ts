// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper HTTP client — wraps all API endpoints used by the MCP tools.
// BASE_URL defaults to the production StarMapper instance.
// Override STARMAPPER_BASE_URL env var for local dev or self-hosted instances.

const BASE_URL = process.env.STARMAPPER_BASE_URL ?? "https://starmapper.bruniaux.com";

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

export const triggerChunk = async (
  owner: string,
  repo: string,
  cursor: string | null,
): Promise<ChunkResult> => {
  const body = cursor ? { owner, repo, cursor } : { owner, repo };
  const res = await fetch(`${BASE_URL}/api/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`StarMapper chunk error ${res.status}`);
  return res.json() as Promise<ChunkResult>;
};
