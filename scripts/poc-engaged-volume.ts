// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * poc-engaged-volume.ts
 *
 * POC-A: how many mappable users can the engaged-audience map recover per repo?
 *
 * For a repo, samples the first 100 nodes of each surviving repo-to-users channel
 * (watchers, mentionableUsers, forks.owner, issues.author, pullRequests.author),
 * measures the share that carry a usable location, and estimates the mappable
 * volume as totalCount * locationRate. Also samples cross-channel overlap to gauge
 * the dedup factor. One GraphQL query per repo, cost ~5 points.
 *
 * Read-only. No DB, no writes.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && pnpm tsx scripts/poc-engaged-volume.ts --repo facebook/react
 *   ... --repo vercel/swr
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { repo: { type: "string", default: "facebook/react" } },
  strict: true,
  args: process.argv.slice(2),
});

const [OWNER, REPO] = (values.repo ?? "facebook/react").split("/");

const TOKENS = [
  process.env.GITHUB_TOKEN,
  process.env.GITHUB_TOKEN_2,
  process.env.GITHUB_TOKEN_3,
  process.env.GITHUB_TOKEN_4,
].filter((t): t is string => Boolean(t && t.length > 0));

if (TOKENS.length === 0) {
  console.error("No GITHUB_TOKEN in env.");
  process.exit(1);
}

let tokenIdx = 0;
const gql = async (query: string): Promise<Record<string, unknown> | null> => {
  for (;;) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `bearer ${TOKENS[tokenIdx]}`,
        "content-type": "application/json",
        "user-agent": "starmapper-poc",
      },
      body: JSON.stringify({ query }),
    });
    if ((res.status === 401 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) && tokenIdx < TOKENS.length - 1) {
      tokenIdx += 1;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: unknown[] };
    if (json.errors) console.warn(`  gql warning: ${JSON.stringify(json.errors).slice(0, 160)}`);
    return json.data ?? null;
  }
};

type Sample = { login: string; location: string | null };

/** A location string is "usable" when non-empty. Real geocoding hit-rate is lower, this is the ceiling. */
const hasLoc = (s: Sample): boolean => Boolean(s.location && s.location.trim().length > 0);

const nodesToSamples = (nodes: unknown[], pick: "self" | "owner" | "author"): Sample[] =>
  nodes
    .map((n): Sample | null => {
      const node = n as Record<string, unknown>;
      const u = (pick === "self" ? node : (node[pick] as Record<string, unknown> | null)) ?? null;
      if (!u || typeof u.login !== "string") return null;
      return { login: u.login, location: (u.location as string | null) ?? null };
    })
    .filter((s): s is Sample => s !== null);

type ChannelStat = { name: string; totalCount: number; sampled: number; withLoc: number; locRate: number; estMappable: number; samples: Sample[] };

const stat = (name: string, totalCount: number, samples: Sample[]): ChannelStat => {
  const withLoc = samples.filter(hasLoc).length;
  const locRate = samples.length > 0 ? withLoc / samples.length : 0;
  return { name, totalCount, sampled: samples.length, withLoc, locRate, estMappable: Math.round(totalCount * locRate), samples };
};

const main = async (): Promise<void> => {
  console.log(`\nPOC-A engaged-audience volume: ${OWNER}/${REPO}\n`);

  const data = await gql(`{
    repository(owner:"${OWNER}", name:"${REPO}") {
      stargazerCount
      watchers(first:100){ totalCount nodes{ login location } }
      mentionableUsers(first:100){ totalCount nodes{ login location } }
      forks(first:100){ totalCount nodes{ owner{ login ... on User { location } } } }
      issues(first:100){ totalCount nodes{ author{ login ... on User { location } } } }
      pullRequests(first:100){ totalCount nodes{ author{ login ... on User { location } } } }
    }
    rateLimit { cost remaining }
  }`);

  const repo = data?.repository as Record<string, any> | null;
  if (!repo) {
    console.error("No repository data (private, renamed, or blocked).");
    process.exit(1);
  }

  const stars = repo.stargazerCount as number;
  const channels: ChannelStat[] = [
    stat("watchers", repo.watchers.totalCount, nodesToSamples(repo.watchers.nodes, "self")),
    stat("mentionableUsers", repo.mentionableUsers.totalCount, nodesToSamples(repo.mentionableUsers.nodes, "self")),
    stat("forks.owner", repo.forks.totalCount, nodesToSamples(repo.forks.nodes, "owner")),
    stat("issues.author", repo.issues.totalCount, nodesToSamples(repo.issues.nodes, "author")),
    stat("pullRequests.author", repo.pullRequests.totalCount, nodesToSamples(repo.pullRequests.nodes, "author")),
  ];

  console.log(`stargazerCount (DEAD, reference only): ${stars.toLocaleString()}\n`);
  console.log("channel               totalCount   sample  loc%   est. mappable");
  console.log("─".repeat(66));
  for (const c of channels) {
    console.log(
      `${c.name.padEnd(20)} ${String(c.totalCount).padStart(10)}   ${String(c.sampled).padStart(4)}   ${(c.locRate * 100).toFixed(0).padStart(3)}%   ${c.estMappable.toLocaleString().padStart(12)}`,
    );
  }

  // Dedup gauge from the samples: union of distinct logins vs sum of samples.
  const union = new Map<string, Sample>();
  let summed = 0;
  for (const c of channels) {
    summed += c.samples.length;
    for (const s of c.samples) if (!union.has(s.login)) union.set(s.login, s);
  }
  const unionWithLoc = [...union.values()].filter(hasLoc).length;
  const dedupFactor = summed > 0 ? union.size / summed : 1;

  const naiveSum = channels.reduce((a, c) => a + c.estMappable, 0);
  const dedupAdjusted = Math.round(naiveSum * dedupFactor);

  console.log("─".repeat(66));
  console.log(`\nDedup gauge (from ${summed} sampled nodes across channels):`);
  console.log(`  distinct logins in sample : ${union.size}  (overlap factor ${dedupFactor.toFixed(2)})`);
  console.log(`  distinct WITH location    : ${unionWithLoc}`);
  console.log(`\nEstimated engaged mappable users for ${OWNER}/${REPO}:`);
  console.log(`  naive sum of channels     : ~${naiveSum.toLocaleString()}`);
  console.log(`  dedup-adjusted estimate   : ~${dedupAdjusted.toLocaleString()}`);
  console.log(`  vs dead stargazer count   : ${stars.toLocaleString()}  (${((dedupAdjusted / stars) * 100).toFixed(1)}% recovered)`);
  console.log(`\nGraphQL cost this run: ${(data?.rateLimit as any)?.cost} pt(s). Estimates extrapolate a 100-node sample to totalCount, treat as ceiling.\n`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
