// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

const parseRateLimitResetAt = (headers: Headers): number => {
  const retryAfter = headers.get("retry-after");
  const resetEpoch = headers.get("x-ratelimit-reset");
  if (retryAfter) return Date.now() + parseInt(retryAfter, 10) * 1000;
  if (resetEpoch) return parseInt(resetEpoch, 10) * 1000;
  return Date.now() + 60_000;
};

const parseQuotaRemaining = (headers: Headers): number | null => {
  const raw = headers.get("x-ratelimit-remaining");
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
};

export class GitHubRateLimitError extends Error {
  resetAt: number; // ms epoch
  constructor(resetAt: number) {
    super("rate_limited");
    this.resetAt = resetAt;
  }
}

export class GitHubTokenInvalidError extends Error {
  constructor() {
    super("token_invalid");
  }
}

export type StargazerRaw = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  accountCreatedAt: string | null;
  avatarUrl: string;
  starredAt: string; // ISO 8601
  linkedinUrl: string | null;
};

export type StargazersPage = {
  stargazers: StargazerRaw[];
  nextCursor: string | null;
  totalCount: number;
  quotaRemaining: number | null;
};

export type FollowerRaw = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  accountCreatedAt: string | null;
  avatarUrl: string;
};

export type FollowersPage = {
  followers: FollowerRaw[];
  nextCursor: string | null;
  totalCount: number;
  quotaRemaining: number | null;
};

export const fetchStargazersPage = async (
  owner: string,
  repo: string,
  cursor: string | null,
  since?: string, // ISO timestamp — stop when we hit stars older than this
  clientToken?: string, // user-provided PAT from localStorage
): Promise<StargazersPage> => {
  const token = clientToken || process.env.GITHUB_TOKEN;
  const query = `
    query($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        stargazerCount
        stargazers(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
          pageInfo { hasNextPage endCursor }
          edges {
            starredAt
            node {
              login
              name
              bio
              company
              location
              avatarUrl
              createdAt
              followers { totalCount }
              following { totalCount }
              repositories(first: 0) { totalCount }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables: cursor ? { owner, repo, cursor } : { owner, repo } }),
  });

  if (!res.ok && (res.status === 403 || res.status === 429)) {
    throw new GitHubRateLimitError(parseRateLimitResetAt(res.headers));
  }
  if (res.status === 401) throw new GitHubTokenInvalidError();
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const quotaRemaining = parseQuotaRemaining(res.headers);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  const data = json.data.repository;
  const page = data.stargazers;

  const sinceTs = since ? new Date(since).getTime() : null;
  let hasMore = page.pageInfo.hasNextPage;
  const stargazers: StargazerRaw[] = [];

  for (const e of page.edges) {
    if (sinceTs !== null && new Date(e.starredAt).getTime() <= sinceTs) {
      hasMore = false; // hit stars we already have — stop here
      break;
    }
    stargazers.push({
      login: e.node.login,
      name: e.node.name ?? null,
      bio: e.node.bio ?? null,
      company: e.node.company ? e.node.company.trim().replace(/^@/, "") : null,
      location: e.node.location ?? null,
      followers: e.node.followers.totalCount,
      following: e.node.following.totalCount,
      publicRepos: e.node.repositories.totalCount,
      accountCreatedAt: e.node.createdAt ?? null,
      avatarUrl: e.node.avatarUrl,
      starredAt: e.starredAt,
      linkedinUrl: null,
    });
  }

  return {
    totalCount: data.stargazerCount,
    nextCursor: hasMore ? page.pageInfo.endCursor : null,
    stargazers,
    quotaRemaining,
  };
};

type GraphQLFollowerNode = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  avatarUrl: string;
  createdAt: string | null;
  followers: { totalCount: number };
  following: { totalCount: number };
  repositories: { totalCount: number };
};

export const fetchFollowersPage = async (
  login: string,
  cursor: string | null,
  clientToken?: string,
): Promise<FollowersPage> => {
  const token = clientToken || process.env.GITHUB_TOKEN;
  const query = `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        followers(first: 100, after: $cursor) {
          nodes {
            login
            name
            bio
            company
            location
            avatarUrl
            createdAt
            followers { totalCount }
            following { totalCount }
            repositories(first: 0) { totalCount }
          }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    }
  `;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: cursor ? { login, cursor } : { login },
    }),
  });

  if (!res.ok && (res.status === 403 || res.status === 429)) {
    throw new GitHubRateLimitError(parseRateLimitResetAt(res.headers));
  }
  if (res.status === 401) throw new GitHubTokenInvalidError();
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const quotaRemaining = parseQuotaRemaining(res.headers);

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  const data = json.data.user.followers;
  const hasMore = data.pageInfo.hasNextPage;

  const followers: FollowerRaw[] = (data.nodes as GraphQLFollowerNode[]).map((node) => ({
    login: node.login,
    name: node.name ?? null,
    bio: node.bio ?? null,
    company: node.company ? node.company.trim().replace(/^@/, "") : null,
    location: node.location ?? null,
    followers: node.followers.totalCount,
    following: node.following.totalCount,
    publicRepos: node.repositories.totalCount,
    accountCreatedAt: node.createdAt ?? null,
    avatarUrl: node.avatarUrl,
  }));

  return {
    totalCount: data.totalCount,
    nextCursor: hasMore ? data.pageInfo.endCursor : null,
    followers,
    quotaRemaining,
  };
};
