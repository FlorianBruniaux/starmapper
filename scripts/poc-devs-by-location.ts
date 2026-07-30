// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * poc-devs-by-location.ts
 *
 * POC-C: how many mappable developers can we surface per place, with no repo at all,
 * straight from GitHub user search?
 *
 * `search(type:USER, query:"location:X")` returns every user whose location field
 * matches X. That is a map of developers by place, a feature the old stargazer
 * model could not build. This measures the pool size per place and flags the
 * search retrieval cap (GitHub returns at most 1,000 results per query, though
 * userCount reports the true total).
 *
 * Read-only. ~1 point per place. Usage:
 *   set -a && . ./.env.local && set +a && pnpm tsx scripts/poc-devs-by-location.ts
 */

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

// Cities and countries, a spread across regions to see where the pool is dense.
const PLACES = [
  "Paris", "Lyon", "London", "Berlin", "Amsterdam", "San Francisco", "New York",
  "Tokyo", "Bangalore", "Bengaluru", "Shanghai", "São Paulo", "Lagos", "Toronto",
  "France", "Germany", "United States", "India", "China", "Brazil", "Nigeria",
];

const SEARCH_RETRIEVAL_CAP = 1000; // GitHub returns at most 1,000 results per search query

const countFor = async (place: string): Promise<number> => {
  const q = `location:"${place.replace(/"/g, "")}"`;
  const data = await gql(`{ search(type:USER, query:${JSON.stringify(q)}, first:1){ userCount } }`);
  const search = data?.search as { userCount?: number } | undefined;
  return search?.userCount ?? 0;
};

const main = async (): Promise<void> => {
  console.log("\nPOC-C devs-by-location: mappable dev pool per place (search type:USER)\n");
  console.log("place                userCount    retrievable   note");
  console.log("─".repeat(64));

  let total = 0;
  for (const place of PLACES) {
    const n = await countFor(place);
    total += n;
    const retrievable = Math.min(n, SEARCH_RETRIEVAL_CAP);
    const note = n > SEARCH_RETRIEVAL_CAP ? `capped, only ${SEARCH_RETRIEVAL_CAP} fetchable/query` : "fully fetchable";
    console.log(`${place.padEnd(20)} ${n.toLocaleString().padStart(9)}   ${retrievable.toLocaleString().padStart(11)}   ${note}`);
  }

  console.log("─".repeat(64));
  console.log(`\nEvery matched user has a location by construction, so location-present is ~100%.`);
  console.log(`The real ceiling per single query is the ${SEARCH_RETRIEVAL_CAP}-result retrieval cap.`);
  console.log(`To go past it, split by a second facet (followers ranges, language, joined date)`);
  console.log(`and page each slice, the same trick star-search tools use to beat the 1k cap.`);
  console.log(`\nThis is a repo-free map: "developers in X", straight from user search.\n`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
