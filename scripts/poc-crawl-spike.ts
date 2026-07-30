// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * poc-crawl-spike.ts
 *
 * POC-D: validate the reverse-crawl timeline. Crawls starredRepositories fully for
 * a sample of heavy-follower users (worst case, they star the most), measuring
 * pages per user and the real GraphQL point cost per page.
 *
 * Confirms two numbers the crawl estimate rests on: pts/page (expected 1) and the
 * pages/user distribution (the ~1.5 average assumed for 2.21M users).
 *
 * Read-only. Bounded: N users, page cap per user. Usage:
 *   set -a && . ./.env.local && set +a && pnpm tsx scripts/poc-crawl-spike.ts
 *   ... --users 25 --page-cap 15
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    users: { type: "string", default: "25" },
    "page-cap": { type: "string", default: "15" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const N_USERS = parseInt(values.users ?? "25", 10);
const PAGE_CAP = parseInt(values["page-cap"] ?? "15", 10);

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
      headers: { authorization: `bearer ${TOKENS[tokenIdx]}`, "content-type": "application/json", "user-agent": "starmapper-poc" },
      body: JSON.stringify({ query }),
    });
    if ((res.status === 401 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) && tokenIdx < TOKENS.length - 1) {
      tokenIdx += 1;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: unknown[] };
    if (json.errors) console.warn(`  warn: ${JSON.stringify(json.errors).slice(0, 120)}`);
    return json.data ?? null;
  }
};

const heavyUsers = async (n: number): Promise<string[]> => {
  const data = await gql(`{ search(type:USER, query:"followers:>10000", first:${Math.min(n, 100)}){ nodes{ ... on User { login } } } }`);
  const nodes = (data?.search as { nodes?: Array<{ login?: string }> } | undefined)?.nodes ?? [];
  return nodes.map((x) => x.login).filter((l): l is string => typeof l === "string");
};

type UserCrawl = { login: string; stars: number; pages: number; costTotal: number; truncated: boolean };

const crawlUser = async (login: string): Promise<UserCrawl> => {
  let cursor: string | null = null;
  let pages = 0;
  let stars = 0;
  let costTotal = 0;
  let hasNext = true;
  let truncated = false;

  while (hasNext) {
    if (pages >= PAGE_CAP) {
      truncated = true;
      break;
    }
    const after: string = cursor ? `, after:"${cursor}"` : "";
    const data: Record<string, unknown> | null = await gql(
      `{ user(login:"${login}"){ starredRepositories(first:100${after}){ totalCount pageInfo{ hasNextPage endCursor } edges{ starredAt node{ nameWithOwner } } } } rateLimit{ cost } }`,
    );
    const sr = (data?.user as { starredRepositories?: { totalCount?: number; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; edges?: unknown[] } } | undefined)?.starredRepositories;
    if (!sr) break;
    pages += 1;
    stars += sr.edges?.length ?? 0;
    costTotal += ((data?.rateLimit as { cost?: number } | undefined)?.cost ?? 0);
    hasNext = Boolean(sr.pageInfo?.hasNextPage);
    cursor = sr.pageInfo?.endCursor ?? null;
  }
  return { login, stars, pages, costTotal, truncated };
};

const stats = (xs: number[]): { min: number; median: number; max: number; avg: number } => {
  if (xs.length === 0) return { min: 0, median: 0, max: 0, avg: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
  return { min: s[0] as number, median, max: s[s.length - 1] as number, avg: xs.reduce((a, b) => a + b, 0) / xs.length };
};

const main = async (): Promise<void> => {
  console.log(`\nPOC-D crawl spike: ${N_USERS} heavy users, page cap ${PAGE_CAP} (${PAGE_CAP * 100} stars)\n`);
  const logins = await heavyUsers(N_USERS);
  console.log(`Got ${logins.length} heavy-follower users. Crawling...\n`);

  const results: UserCrawl[] = [];
  for (const login of logins) {
    const r = await crawlUser(login);
    results.push(r);
    console.log(`  ${login.padEnd(24)} ${String(r.stars).padStart(5)} stars  ${String(r.pages).padStart(2)} pages  cost ${r.costTotal}${r.truncated ? "  (capped)" : ""}`);
  }

  const pageStats = stats(results.map((r) => r.pages));
  const starStats = stats(results.map((r) => r.stars));
  const totalCost = results.reduce((a, r) => a + r.costTotal, 0);
  const totalPages = results.reduce((a, r) => a + r.pages, 0);
  const truncatedCount = results.filter((r) => r.truncated).length;

  console.log(`\n─── Findings ───`);
  console.log(`pages/user   : min ${pageStats.min}, median ${pageStats.median}, max ${pageStats.max}, avg ${pageStats.avg.toFixed(1)}${truncatedCount ? ` (${truncatedCount} capped, real avg higher)` : ""}`);
  console.log(`stars/user   : min ${starStats.min}, median ${starStats.median}, max ${starStats.max}, avg ${starStats.avg.toFixed(0)}`);
  console.log(`cost/page    : ${totalPages > 0 ? (totalCost / totalPages).toFixed(2) : "n/a"} pt (expected 1.00)`);
  console.log(`\nNote: heavy-follower users are the WORST case (they star the most). The real`);
  console.log(`2.21M pool average is far lower. Recompute the timeline with this avg once`);
  console.log(`the cap is removed on a smaller uncapped sample.\n`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
