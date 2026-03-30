// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

export class GitHubRateLimitError extends Error {
  resetAt: number; // ms epoch
  constructor(resetAt: number) {
    super("rate_limited");
    this.resetAt = resetAt;
  }
}

export interface StargazerRaw {
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
}

export interface StargazersPage {
  stargazers: StargazerRaw[];
  nextCursor: string | null;
  totalCount: number;
}

export async function fetchStargazersPage(
  owner: string,
  repo: string,
  cursor: string | null,
  since?: string, // ISO timestamp — stop when we hit stars older than this
  clientToken?: string, // user-provided PAT from localStorage
): Promise<StargazersPage> {
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
              socialAccounts(first: 5) {
                nodes { provider url }
              }
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
    body: JSON.stringify({ query, variables: { owner, repo, cursor } }),
  });

  if (!res.ok && (res.status === 403 || res.status === 429)) {
    // Primary rate limit: x-ratelimit-remaining === "0"
    // Secondary rate limit: retry-after header present
    const resetEpoch = res.headers.get("x-ratelimit-reset");
    const retryAfter = res.headers.get("retry-after");
    let resetAt: number;
    if (retryAfter) {
      resetAt = Date.now() + parseInt(retryAfter, 10) * 1000;
    } else if (resetEpoch) {
      resetAt = parseInt(resetEpoch, 10) * 1000;
    } else {
      resetAt = Date.now() + 60_000; // fallback: 1 min
    }
    throw new GitHubRateLimitError(resetAt);
  }
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
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
    const linkedinNode = (e.node.socialAccounts?.nodes ?? []).find(
      (n: { provider: string; url: string }) => n.provider === "LINKEDIN",
    );
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
      linkedinUrl: linkedinNode?.url?.startsWith("https://") ? linkedinNode.url : null,
    });
  }

  return {
    totalCount: data.stargazerCount,
    nextCursor: hasMore ? page.pageInfo.endCursor : null,
    stargazers,
  };
}
