// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Engaged-audience fetch: the live per-repo map replacement for the dead stargazer
 * scan (GitHub closed Repository.stargazers on 2026-07-23).
 *
 * GitHub left several repo-to-users connections open, each carrying login and
 * location inline. This unions them into one deduplicated engaged-user set:
 *
 *   fork     repository.forks.owner        (strongest signal, biggest volume)
 *   issue    repository.issues.author
 *   pr       repository.pullRequests.author
 *   mention  repository.mentionableUsers
 *   watch    repository.watchers           (fragile: on the restriction list, still open)
 *
 * Measured recovery is 6-16% of the dead star count, but this crowd is engaged
 * (forkers, contributors, issue/PR authors), not drive-by stargazers, and the
 * location-present rate runs 57-89%. See claudedocs/github-api-surface-inventory.md.
 *
 * This module only fetches and deduplicates. Geocoding (via geocodeBatch) and the
 * engaged_cache write happen in the caller (scripts/ops/index-engaged.ts), the same
 * split the stargazer path uses.
 */

export type EngagedChannel = "fork" | "issue" | "pr" | "mention" | "watch";

/** All channels, ordered by durability. `watch` is last because it may close next. */
export const ENGAGED_CHANNELS: readonly EngagedChannel[] = ["fork", "issue", "pr", "mention", "watch"];

export type EngagedUser = {
  login: string;
  name: string | null;
  location: string | null;
  followers: number;
  /** Which channels surfaced this user, e.g. ["fork", "issue"]. */
  channels: EngagedChannel[];
};

export type EngagedResult = {
  users: EngagedUser[];
  /** Distinct-user count per channel, before dedup. */
  byChannel: Record<EngagedChannel, number>;
  /** stargazerCount, read alongside for the coverage denominator. Dead for enumeration, alive as a scalar. */
  starCount: number;
  /** Channels that errored (e.g. watch closing). The union still returns from the rest. */
  failedChannels: EngagedChannel[];
};

type RawUser = { login?: string | null; name?: string | null; location?: string | null; followers?: { totalCount?: number } | null };

type Connection = {
  totalCount?: number;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: unknown[];
};

/** Per-channel wiring: how to page its connection and pull a user node out. */
type ChannelSpec = {
  /** GraphQL connection body, `CURSOR` replaced with the after argument. */
  connectionField: (cursor: string | null) => string;
  /** Path from repository to the connection object. */
  connectionKey: string;
  /** Extract the user from one connection node (owner/author wrappers differ). */
  toUser: (node: unknown) => RawUser | null;
};

const userFields = "login name location followers { totalCount }";
const afterArg = (cursor: string | null): string => (cursor ? `, after: "${cursor}"` : "");

const CHANNEL_SPECS: Record<EngagedChannel, ChannelSpec> = {
  fork: {
    connectionField: (c) => `forks(first: 100${afterArg(c)}) { totalCount pageInfo { hasNextPage endCursor } nodes { owner { __typename ... on User { ${userFields} } } } }`,
    connectionKey: "forks",
    toUser: (n) => {
      const owner = (n as { owner?: Record<string, unknown> })?.owner;
      // Org-owned forks have no location/followers under the User fragment; skip them.
      return owner && owner.__typename === "User" ? (owner as RawUser) : null;
    },
  },
  issue: {
    connectionField: (c) => `issues(first: 100${afterArg(c)}) { totalCount pageInfo { hasNextPage endCursor } nodes { author { __typename ... on User { ${userFields} } } } }`,
    connectionKey: "issues",
    toUser: (n) => {
      const a = (n as { author?: Record<string, unknown> })?.author;
      return a && a.__typename === "User" ? (a as RawUser) : null;
    },
  },
  pr: {
    connectionField: (c) => `pullRequests(first: 100${afterArg(c)}) { totalCount pageInfo { hasNextPage endCursor } nodes { author { __typename ... on User { ${userFields} } } } }`,
    connectionKey: "pullRequests",
    toUser: (n) => {
      const a = (n as { author?: Record<string, unknown> })?.author;
      return a && a.__typename === "User" ? (a as RawUser) : null;
    },
  },
  mention: {
    connectionField: (c) => `mentionableUsers(first: 100${afterArg(c)}) { totalCount pageInfo { hasNextPage endCursor } nodes { ${userFields} } }`,
    connectionKey: "mentionableUsers",
    toUser: (n) => (n as RawUser) ?? null,
  },
  watch: {
    connectionField: (c) => `watchers(first: 100${afterArg(c)}) { totalCount pageInfo { hasNextPage endCursor } nodes { ${userFields} } }`,
    connectionKey: "watchers",
    toUser: (n) => (n as RawUser) ?? null,
  },
};

export type GqlFetcher = (query: string) => Promise<{ data: Record<string, unknown> | null; errors?: unknown[] }>;

export type EngagedOptions = {
  /** Which channels to union. Default: all. Drop "watch" if it starts erroring. */
  channels?: readonly EngagedChannel[];
  /** Max pages (100 users each) per channel, to bound cost on huge repos. Default 20 = 2000 users/channel. */
  pageCap?: number;
  /** Injected GraphQL transport, so tests run without network. */
  fetcher: GqlFetcher;
};

const at = (obj: unknown, key: string): unknown => (obj as Record<string, unknown> | null)?.[key];

/** Pages one channel to the cap, returning its raw users. Throws on GraphQL error so the caller can flag it. */
const fetchChannel = async (
  owner: string,
  repo: string,
  channel: EngagedChannel,
  pageCap: number,
  fetcher: GqlFetcher,
): Promise<RawUser[]> => {
  const spec = CHANNEL_SPECS[channel];
  const out: RawUser[] = [];
  let cursor: string | null = null;
  let pages = 0;

  while (pages < pageCap) {
    const query = `{ repository(owner: "${owner}", name: "${repo}") { ${spec.connectionField(cursor)} } }`;
    const { data, errors } = await fetcher(query);
    if (errors && errors.length > 0) {
      const msg = (errors[0] as { message?: string })?.message ?? "graphql error";
      throw new Error(`channel ${channel}: ${msg}`);
    }
    const conn = at(at(data, "repository"), spec.connectionKey) as Connection | null;
    if (!conn) break;
    for (const node of conn.nodes ?? []) {
      const u = spec.toUser(node);
      if (u?.login) out.push(u);
    }
    pages += 1;
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }
  return out;
};

const readStarCount = async (owner: string, repo: string, fetcher: GqlFetcher): Promise<number> => {
  const { data } = await fetcher(`{ repository(owner: "${owner}", name: "${repo}") { stargazerCount } }`);
  const count = at(at(data, "repository"), "stargazerCount");
  return typeof count === "number" ? count : 0;
};

/**
 * Fetches the engaged audience of a repo: unions the surviving repo-to-users
 * channels, deduplicates by login, and records which channels surfaced each user.
 * A channel that errors is skipped and reported in `failedChannels`, so a closing
 * `watch` never takes the whole map down.
 */
export const fetchEngagedAudience = async (
  owner: string,
  repo: string,
  opts: EngagedOptions,
): Promise<EngagedResult> => {
  const channels = opts.channels ?? ENGAGED_CHANNELS;
  const pageCap = opts.pageCap ?? 20;
  const { fetcher } = opts;

  const byLogin = new Map<string, EngagedUser>();
  const byChannel = { fork: 0, issue: 0, pr: 0, mention: 0, watch: 0 } as Record<EngagedChannel, number>;
  const failedChannels: EngagedChannel[] = [];

  for (const channel of channels) {
    let raw: RawUser[];
    try {
      raw = await fetchChannel(owner, repo, channel, pageCap, fetcher);
    } catch {
      failedChannels.push(channel);
      continue;
    }
    const seenThisChannel = new Set<string>();
    for (const u of raw) {
      const login = u.login as string;
      if (!seenThisChannel.has(login)) seenThisChannel.add(login);
      const existing = byLogin.get(login);
      if (existing) {
        if (!existing.channels.includes(channel)) existing.channels.push(channel);
        // Keep the first non-null location/name we saw, fill gaps from later channels.
        if (!existing.location && u.location) existing.location = u.location;
        if (!existing.name && u.name) existing.name = u.name;
      } else {
        byLogin.set(login, {
          login,
          name: u.name ?? null,
          location: u.location ?? null,
          followers: u.followers?.totalCount ?? 0,
          channels: [channel],
        });
      }
    }
    byChannel[channel] = seenThisChannel.size;
  }

  const starCount = await readStarCount(owner, repo, fetcher).catch(() => 0);

  return { users: [...byLogin.values()], byChannel, starCount, failedChannels };
};
