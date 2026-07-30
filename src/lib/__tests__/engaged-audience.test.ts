// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi } from "vitest";

import { fetchEngagedAudience, type GqlFetcher } from "@/lib/engaged-audience";

/** Builds a single-page connection payload for a given repository connection key. */
const conn = (key: string, nodes: unknown[]): { data: Record<string, unknown> } => ({
  data: { repository: { [key]: { totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
});

const forkNode = (login: string, location: string | null, followers = 0) => ({
  owner: { __typename: "User", login, name: null, location, followers: { totalCount: followers } },
});
const authorNode = (login: string, location: string | null) => ({
  author: { __typename: "User", login, name: null, location, followers: { totalCount: 0 } },
});
const userNode = (login: string, location: string | null) => ({ login, name: null, location, followers: { totalCount: 0 } });

/** Routes a query to the right canned response by which connection field it asks for. */
const router = (map: Partial<Record<string, unknown[]>>): GqlFetcher => {
  return vi.fn(async (query: string) => {
    if (query.includes("stargazerCount")) return { data: { repository: { stargazerCount: 1000 } } };
    if (query.includes("forks(")) return conn("forks", map.fork ?? []);
    if (query.includes("issues(")) return conn("issues", map.issue ?? []);
    if (query.includes("pullRequests(")) return conn("pullRequests", map.pr ?? []);
    if (query.includes("mentionableUsers(")) return conn("mentionableUsers", map.mention ?? []);
    if (query.includes("watchers(")) return conn("watchers", map.watch ?? []);
    return { data: null };
  });
};

describe("fetchEngagedAudience", () => {
  it("unions users across channels and deduplicates by login", async () => {
    const fetcher = router({
      fork: [forkNode("alice", "Paris")],
      issue: [authorNode("alice", "Paris"), authorNode("bob", "Berlin")],
      pr: [authorNode("carol", "London")],
    });

    const res = await fetchEngagedAudience("o", "r", { fetcher });

    const logins = res.users.map((u) => u.login).sort();
    expect(logins).toEqual(["alice", "bob", "carol"]);
    // alice appeared in fork AND issue, deduped to one user with both channels.
    const alice = res.users.find((u) => u.login === "alice");
    expect(alice?.channels.sort()).toEqual(["fork", "issue"]);
  });

  it("records the distinct-user count per channel", async () => {
    const fetcher = router({
      fork: [forkNode("alice", "Paris"), forkNode("bob", "Berlin")],
      watch: [userNode("carol", "Lyon")],
    });

    const res = await fetchEngagedAudience("o", "r", { fetcher });

    expect(res.byChannel.fork).toBe(2);
    expect(res.byChannel.watch).toBe(1);
    expect(res.byChannel.issue).toBe(0);
  });

  it("fills a missing location from a later channel", async () => {
    const fetcher = router({
      fork: [forkNode("alice", null)],
      issue: [authorNode("alice", "Paris")],
    });

    const res = await fetchEngagedAudience("o", "r", { fetcher });

    expect(res.users.find((u) => u.login === "alice")?.location).toBe("Paris");
  });

  it("skips org-owned forks (no User node)", async () => {
    const fetcher = vi.fn(async (query: string) => {
      if (query.includes("stargazerCount")) return { data: { repository: { stargazerCount: 5 } } };
      if (query.includes("forks(")) {
        return {
          data: {
            repository: {
              forks: {
                totalCount: 2,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ owner: { __typename: "Organization", login: "acme" } }, forkNode("alice", "Paris")],
              },
            },
          },
        };
      }
      return { data: { repository: {} } };
    }) as GqlFetcher;

    const res = await fetchEngagedAudience("o", "r", { fetcher, channels: ["fork"] });

    expect(res.users.map((u) => u.login)).toEqual(["alice"]);
  });

  it("skips a channel that errors and reports it, keeping the rest", async () => {
    const fetcher = vi.fn(async (query: string) => {
      if (query.includes("stargazerCount")) return { data: { repository: { stargazerCount: 10 } } };
      if (query.includes("watchers(")) return { data: null, errors: [{ message: "watchers closed" }] };
      if (query.includes("forks(")) return conn("forks", [forkNode("alice", "Paris")]);
      return { data: { repository: {} } };
    }) as GqlFetcher;

    const res = await fetchEngagedAudience("o", "r", { fetcher, channels: ["fork", "watch"] });

    expect(res.failedChannels).toEqual(["watch"]);
    expect(res.users.map((u) => u.login)).toEqual(["alice"]);
  });

  it("paginates a channel up to the page cap", async () => {
    let call = 0;
    const fetcher = vi.fn(async (query: string) => {
      if (query.includes("stargazerCount")) return { data: { repository: { stargazerCount: 999 } } };
      if (query.includes("forks(")) {
        call += 1;
        return {
          data: {
            repository: {
              forks: {
                totalCount: 500,
                pageInfo: { hasNextPage: true, endCursor: `cur${call}` },
                nodes: [forkNode(`user${call}`, "Paris")],
              },
            },
          },
        };
      }
      return { data: { repository: {} } };
    }) as GqlFetcher;

    const res = await fetchEngagedAudience("o", "r", { fetcher, channels: ["fork"], pageCap: 3 });

    // Cap 3 → exactly 3 fork pages fetched despite hasNextPage staying true.
    expect(call).toBe(3);
    expect(res.users).toHaveLength(3);
  });

  it("reads starCount for the coverage denominator", async () => {
    const fetcher = router({ fork: [forkNode("alice", "Paris")] });
    const res = await fetchEngagedAudience("o", "r", { fetcher, channels: ["fork"] });
    expect(res.starCount).toBe(1000);
  });
});
