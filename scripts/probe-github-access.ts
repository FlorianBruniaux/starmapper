// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * probe-github-access.ts
 *
 * Fires a battery of GitHub REST + GraphQL probes and classifies each as
 * ALIVE / DEAD / DEGRADED, to map exactly what StarMapper can still reach
 * after the 2026-07-23 stargazer restriction.
 *
 * Two jobs:
 *  1. Inventory the surviving surface (what discovery + reconstruction can use).
 *  2. Measure the real GraphQL point cost of starredRepositories(first:100),
 *     the number the crawl-timeline decision hinges on (ROADMAP Phase 3 risk #2).
 *
 * Read-only. No DB, no writes. Rotates GITHUB_TOKEN..._4 only on rate-limit
 * exhaustion, never on a 403, so a restriction 403 is never masked as a quota hop.
 *
 * Usage:
 *   pnpm tsx scripts/probe-github-access.ts
 *   pnpm tsx scripts/probe-github-access.ts --repo vercel/next.js --user gaearon --org vercel
 *   pnpm tsx scripts/probe-github-access.ts --json     # also dump JSON to claudedocs/
 */

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "facebook/react" },
    user: { type: "string", default: "gaearon" },
    org: { type: "string", default: "facebook" },
    json: { type: "boolean", default: false },
  },
  strict: true,
  args: process.argv.slice(2),
});

const [OWNER, REPO] = (values.repo ?? "facebook/react").split("/");
const USER = values.user ?? "torvalds";
const ORG = values.org ?? "facebook";

const TOKENS = [
  process.env.GITHUB_TOKEN,
  process.env.GITHUB_TOKEN_2,
  process.env.GITHUB_TOKEN_3,
  process.env.GITHUB_TOKEN_4,
].filter((t): t is string => Boolean(t && t.length > 0));

if (TOKENS.length === 0) {
  console.error("No GITHUB_TOKEN in env. Set at least GITHUB_TOKEN and retry.");
  process.exit(1);
}

let tokenIdx = 0;
const currentToken = (): string => TOKENS[tokenIdx] as string;
const rotateToken = (): boolean => {
  if (tokenIdx < TOKENS.length - 1) {
    tokenIdx += 1;
    return true;
  }
  return false;
};

type Verdict = "ALIVE" | "DEAD" | "DEGRADED" | "ERROR";

type ProbeResult = {
  id: string;
  group: string;
  kind: "graphql" | "rest";
  target: string;
  expected: Verdict;
  verdict: Verdict;
  detail: string;
  cost: number | null; // GraphQL point cost when known
};

// ── Transport ─────────────────────────────────────────────────────────────────

type GqlResponse = { data: Record<string, unknown> | null; errors?: unknown[]; status: number };

const gql = async (query: string): Promise<GqlResponse> => {
  for (;;) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        authorization: `bearer ${currentToken()}`,
        "content-type": "application/json",
        "user-agent": "starmapper-probe",
      },
      body: JSON.stringify({ query }),
    });
    if (res.status === 401 && rotateToken()) continue;
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0" && rotateToken()) {
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: Record<string, unknown>;
      errors?: unknown[];
    };
    return { data: json.data ?? null, errors: json.errors, status: res.status };
  }
};

type RestResponse = { status: number; body: unknown };

const rest = async (path: string): Promise<RestResponse> => {
  for (;;) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `bearer ${currentToken()}`,
        accept: "application/vnd.github+json",
        "user-agent": "starmapper-probe",
      },
    });
    if (res.status === 401 && rotateToken()) continue;
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0" && rotateToken()) {
      continue;
    }
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
};

// ── Extract helpers ─────────────────────────────────────────────────────────

/** Reads rateLimit.cost from a GraphQL data payload, or null when absent. */
const readCost = (data: Record<string, unknown> | null): number | null => {
  const rl = data?.rateLimit as { cost?: number } | undefined;
  return typeof rl?.cost === "number" ? rl.cost : null;
};

const at = (obj: unknown, path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => (acc as Record<string, unknown> | null)?.[key], obj);

// ── Probe primitives ──────────────────────────────────────────────────────────

/**
 * GraphQL connection probe. A connection is DEAD when totalCount > 0 but the
 * edges come back empty (the exact signature of the stargazer restriction).
 */
const gqlConnection = async (opts: {
  id: string;
  group: string;
  target: string;
  expected: Verdict;
  query: string;
  connPath: string[]; // path to the connection object holding totalCount + edges/nodes
}): Promise<ProbeResult> => {
  const { data, errors, status } = await gql(opts.query);
  const base = { id: opts.id, group: opts.group, kind: "graphql" as const, target: opts.target, expected: opts.expected, cost: readCost(data) };

  if (errors && errors.length > 0) {
    const msg = (errors[0] as { message?: string })?.message ?? "graphql error";
    return { ...base, verdict: "ERROR", detail: `errors: ${msg} (http ${status})` };
  }
  const conn = at(data, opts.connPath) as
    | { totalCount?: number; userCount?: number; issueCount?: number; repositoryCount?: number; edges?: unknown[]; nodes?: unknown[] }
    | null;
  if (!conn) return { ...base, verdict: "ERROR", detail: "connection path returned null" };

  // search connections expose userCount/issueCount/repositoryCount, not totalCount.
  const total = conn.totalCount ?? conn.userCount ?? conn.issueCount ?? conn.repositoryCount ?? 0;
  const len = (conn.edges?.length ?? conn.nodes?.length ?? 0) as number;

  if (len > 0) return { ...base, verdict: "ALIVE", detail: `${len} nodes, totalCount ${total}` };
  if (total > 0) return { ...base, verdict: "DEAD", detail: `totalCount ${total} but 0 nodes (connection closed)` };
  return { ...base, verdict: "DEGRADED", detail: "totalCount 0, inconclusive on this target" };
};

/** GraphQL scalar probe: alive when the field comes back as a value. */
const gqlScalar = async (opts: {
  id: string;
  group: string;
  target: string;
  query: string;
  valuePath: string[];
}): Promise<ProbeResult> => {
  const { data, errors, status } = await gql(opts.query);
  const base = { id: opts.id, group: opts.group, kind: "graphql" as const, target: opts.target, expected: "ALIVE" as Verdict, cost: readCost(data) };
  if (errors && errors.length > 0) {
    const msg = (errors[0] as { message?: string })?.message ?? "graphql error";
    return { ...base, verdict: "ERROR", detail: `errors: ${msg} (http ${status})` };
  }
  const v = at(data, opts.valuePath);
  if (v === null || v === undefined) return { ...base, verdict: "DEAD", detail: "field null" };
  return { ...base, verdict: "ALIVE", detail: `value ${JSON.stringify(v)}` };
};

/** REST list probe. 404/403 = DEAD (restricted), 200 non-empty = ALIVE. */
const restList = async (opts: {
  id: string;
  group: string;
  target: string;
  expected: Verdict;
  path: string;
}): Promise<ProbeResult> => {
  const { status, body } = await rest(opts.path);
  const base = { id: opts.id, group: opts.group, kind: "rest" as const, target: opts.target, expected: opts.expected, cost: null };
  if (status === 404) return { ...base, verdict: "DEAD", detail: "404 Not Found (restricted or gone)" };
  if (status === 403) return { ...base, verdict: "DEAD", detail: "403 Forbidden (restricted)" };
  if (status >= 400) return { ...base, verdict: "ERROR", detail: `http ${status}` };
  const len = Array.isArray(body) ? body.length : 0;
  if (len > 0) return { ...base, verdict: "ALIVE", detail: `${len} items (http ${status})` };
  return { ...base, verdict: "DEGRADED", detail: `empty array (http ${status})` };
};

// ── The probe battery ──────────────────────────────────────────────────────────

const RL = "rateLimit { cost remaining nodeCount }";

const probes: Array<() => Promise<ProbeResult>> = [
  // Group A — Stargazers: the dead core
  () =>
    gqlConnection({
      id: "gql.repo.stargazers",
      group: "A. Stargazers (expected DEAD)",
      target: `${OWNER}/${REPO}`,
      expected: "DEAD",
      connPath: ["repository", "stargazers"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ stargazers(first:5){ totalCount edges{ node{ login } } } } ${RL} }`,
    }),
  () =>
    gqlScalar({
      id: "gql.repo.stargazerCount",
      group: "A. Stargazers (expected DEAD)",
      target: `${OWNER}/${REPO}`,
      valuePath: ["repository", "stargazerCount"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ stargazerCount } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.repo.stargazers",
      group: "A. Stargazers (expected DEAD)",
      target: `${OWNER}/${REPO}`,
      expected: "DEAD",
      path: `/repos/${OWNER}/${REPO}/stargazers?per_page=5`,
    }),

  // Group B — The inverted-model engine
  () =>
    gqlConnection({
      id: "gql.user.starredRepositories",
      group: "B. Inverted engine (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "starredRepositories"],
      query: `{ user(login:"${USER}"){ starredRepositories(first:5, orderBy:{field:STARRED_AT, direction:DESC}){ totalCount edges{ starredAt node{ nameWithOwner } } } } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.user.starred",
      group: "B. Inverted engine (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      path: `/users/${USER}/starred?per_page=5`,
    }),

  // Group C — User graph, the discovery channels (location inline)
  () =>
    gqlConnection({
      id: "gql.user.followers",
      group: "C. User graph (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "followers"],
      query: `{ user(login:"${USER}"){ followers(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.user.following",
      group: "C. User graph (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "following"],
      query: `{ user(login:"${USER}"){ following(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.user.followers",
      group: "C. User graph (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      path: `/users/${USER}/followers?per_page=5`,
    }),

  // Group D — Repo-side discovery
  () =>
    restList({
      id: "rest.repo.contributors",
      group: "D. Repo discovery (expected ALIVE)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      path: `/repos/${OWNER}/${REPO}/contributors?per_page=5`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.mentionableUsers",
      group: "D. Repo discovery (probe)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "mentionableUsers"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ mentionableUsers(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.repo.commits",
      group: "D. Repo discovery (expected ALIVE)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      path: `/repos/${OWNER}/${REPO}/commits?per_page=5`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.forks",
      group: "D. Repo discovery (witness, expected ALIVE)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "forks"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ forks(first:5){ totalCount nodes{ nameWithOwner owner{ login } } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.pullRequests.authors",
      group: "D. Repo discovery (probe)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "pullRequests"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ pullRequests(first:5, states:MERGED){ totalCount nodes{ author{ login } } } } ${RL} }`,
    }),

  // Group E — Org channels
  () =>
    gqlConnection({
      id: "gql.org.membersWithRole",
      group: "E. Org channels (probe)",
      target: ORG,
      expected: "ALIVE",
      connPath: ["organization", "membersWithRole"],
      query: `{ organization(login:"${ORG}"){ membersWithRole(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.org.public_members",
      group: "E. Org channels (probe)",
      target: ORG,
      expected: "ALIVE",
      path: `/orgs/${ORG}/public_members?per_page=5`,
    }),

  // Group D2 — Repo -> users survivors (the resurrection channels, WITH location)
  () =>
    gqlConnection({
      id: "gql.repo.watchers.location",
      group: "D2. Repo->users survivors (WITH location)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "watchers"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ watchers(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.assignableUsers.location",
      group: "D2. Repo->users survivors (WITH location)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "assignableUsers"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ assignableUsers(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.collaborators",
      group: "D2. Repo->users survivors (WITH location)",
      target: `${OWNER}/${REPO}`,
      expected: "DEAD",
      connPath: ["repository", "collaborators"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ collaborators(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.repo.issues.authors",
      group: "D2. Repo->users survivors (WITH location)",
      target: `${OWNER}/${REPO}`,
      expected: "ALIVE",
      connPath: ["repository", "issues"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ issues(first:5){ totalCount nodes{ author{ login ... on User { location } } } } } ${RL} }`,
    }),

  // Group F — Stargazers cursor-only + watchers REST: confirm the closure signature
  () =>
    gqlConnection({
      id: "gql.repo.stargazers.cursorOnly",
      group: "F. Closure signature (expected DEAD)",
      target: `${OWNER}/${REPO}`,
      expected: "DEAD",
      connPath: ["repository", "stargazers"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ stargazers(first:5){ totalCount pageInfo{ endCursor hasNextPage } } } ${RL} }`,
    }),
  () =>
    restList({
      id: "rest.repo.subscribers",
      group: "F. Watchers (expected DEAD)",
      target: `${OWNER}/${REPO}`,
      expected: "DEAD",
      path: `/repos/${OWNER}/${REPO}/subscribers?per_page=5`,
    }),
  () =>
    restList({
      id: "rest.user.subscriptions",
      group: "F. Watchers (expected DEAD/deprecated)",
      target: USER,
      expected: "DEAD",
      path: `/users/${USER}/subscriptions?per_page=5`,
    }),

  // Group G — Metadata + search (should all be ALIVE)
  () =>
    gqlScalar({
      id: "gql.repo.metadata",
      group: "G. Metadata + search (expected ALIVE)",
      target: `${OWNER}/${REPO}`,
      valuePath: ["repository", "forkCount"],
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ forkCount } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.search.users",
      group: "G. Metadata + search (expected ALIVE)",
      target: "location:Paris",
      expected: "ALIVE",
      connPath: ["search"],
      query: `{ search(type:USER, query:"location:Paris followers:>1000", first:5){ userCount nodes{ ... on User { login location } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.search.issues.mentions",
      group: "G. Metadata + search (expected ALIVE)",
      target: `${REPO} in:body`,
      expected: "ALIVE",
      connPath: ["search"],
      query: `{ search(type:ISSUE, query:"${REPO} in:body", first:5){ issueCount nodes{ ... on Issue { title } } } ${RL} }`,
    }),

  // Group H — User-side enrichment (owned repos, socials, orgs)
  () =>
    gqlConnection({
      id: "gql.user.repositories",
      group: "H. User enrichment (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "repositories"],
      query: `{ user(login:"${USER}"){ repositories(first:5, ownerAffiliations:OWNER, orderBy:{field:STARGAZERS, direction:DESC}){ totalCount nodes{ nameWithOwner stargazerCount } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.user.socialAccounts",
      group: "H. User enrichment (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "socialAccounts"],
      query: `{ user(login:"${USER}"){ socialAccounts(first:5){ totalCount nodes{ provider displayName url } } } ${RL} }`,
    }),
  () =>
    gqlConnection({
      id: "gql.user.organizations",
      group: "H. User enrichment (expected ALIVE)",
      target: USER,
      expected: "ALIVE",
      connPath: ["user", "organizations"],
      query: `{ user(login:"${USER}"){ organizations(first:5){ totalCount nodes{ login location } } } ${RL} }`,
    }),
  () =>
    gqlScalar({
      id: "gql.user.profileFields",
      group: "H. User enrichment (expected ALIVE)",
      target: USER,
      valuePath: ["user", "location"],
      query: `{ user(login:"${USER}"){ login location company bio websiteUrl } ${RL} }`,
    }),
];

// ── Runner + reporting ──────────────────────────────────────────────────────────

const ICON: Record<Verdict, string> = { ALIVE: "🟢", DEAD: "⚫", DEGRADED: "🟡", ERROR: "🔴" };

const main = async (): Promise<void> => {
  console.log(`\nProbing GitHub access as StarMapper — ${TOKENS.length} token(s)`);
  console.log(`repo=${OWNER}/${REPO}  user=${USER}  org=${ORG}\n`);

  const results: ProbeResult[] = [];
  for (const run of probes) {
    // Sequential on purpose: keeps rate-limit accounting clean and readable.
    const r = await run().catch((e): ProbeResult => ({
      id: "unknown",
      group: "?",
      kind: "graphql",
      target: "-",
      expected: "ERROR",
      verdict: "ERROR",
      detail: String(e),
      cost: null,
    }));
    results.push(r);
  }

  let currentGroup = "";
  for (const r of results) {
    if (r.group !== currentGroup) {
      currentGroup = r.group;
      console.log(`\n${currentGroup}`);
    }
    const surprise = r.verdict !== r.expected && r.verdict !== "DEGRADED" ? "  ⚠️ SURPRISE" : "";
    const costTag = r.cost !== null ? `  [cost ${r.cost}]` : "";
    console.log(`  ${ICON[r.verdict]} ${r.verdict.padEnd(8)} ${r.id.padEnd(34)} ${r.detail}${costTag}${surprise}`);
  }

  // Headline: the crawl-cost number the ROADMAP timeline depends on.
  const starred = results.find((r) => r.id === "gql.user.starredRepositories");
  console.log("\n─── Crawl economics ───");
  if (starred?.cost != null) {
    console.log(`starredRepositories(first:5) cost = ${starred.cost} pt(s).`);
    console.log("Re-run with a first:100 page in the crawler to confirm the real per-page cost");
    console.log("before trusting any timeline. At cost=1/page and 4 tokens (20k pts/hr),");
    console.log("2.21M geolocated users at ~1.5 pages each ≈ 7-9 days; a higher cost scales it linearly.");
  } else {
    console.log("Could not read starredRepositories cost (check the probe output above).");
  }

  const alive = results.filter((r) => r.verdict === "ALIVE").length;
  const dead = results.filter((r) => r.verdict === "DEAD").length;
  const surprises = results.filter((r) => r.verdict !== r.expected && r.verdict !== "DEGRADED");
  console.log(`\nSummary: ${alive} alive, ${dead} dead, ${surprises.length} surprise(s), ${results.length} probes.`);
  if (surprises.length > 0) {
    console.log("Surprises (verdict != expected):");
    for (const s of surprises) console.log(`  ${ICON[s.verdict]} ${s.id}: expected ${s.expected}, got ${s.verdict} — ${s.detail}`);
  }

  if (values.json) {
    const stamp = new Date().toISOString().slice(0, 10);
    const out = `claudedocs/github-access-probe-${stamp}.json`;
    await writeFile(out, JSON.stringify({ repo: `${OWNER}/${REPO}`, user: USER, org: ORG, results }, null, 2));
    console.log(`\nJSON written to ${out}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
