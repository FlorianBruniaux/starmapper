// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * poc-admin-exemption.ts
 *
 * POC-F: does the "admins and collaborators" stargazer exemption actually work,
 * and does it depend on the token's scopes?
 *
 * The restriction changelog says stargazers stay available to repo admins and
 * collaborators. A 2026-07-23 test with a scopeless token failed even on an
 * owned repo. This checks all configured tokens: their scopes, and whether each
 * can read stargazers on a repo the token owner admins (default the owner's own).
 *
 * If a `repo`-scoped token gets stargazers back on an owned repo, the OAuth path
 * (user connects, StarMapper maps their own repos at 100%) is viable.
 *
 * Read-only. Usage:
 *   set -a && . ./.env.local && set +a && pnpm tsx scripts/poc-admin-exemption.ts --repo FlorianBruniaux/starmapper
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { repo: { type: "string", default: "FlorianBruniaux/starmapper" } },
  strict: true,
  args: process.argv.slice(2),
});

const [OWNER, REPO] = (values.repo ?? "FlorianBruniaux/starmapper").split("/");

const TOKENS: Array<{ name: string; value: string }> = [
  { name: "GITHUB_TOKEN", value: process.env.GITHUB_TOKEN ?? "" },
  { name: "GITHUB_TOKEN_2", value: process.env.GITHUB_TOKEN_2 ?? "" },
  { name: "GITHUB_TOKEN_3", value: process.env.GITHUB_TOKEN_3 ?? "" },
  { name: "GITHUB_TOKEN_4", value: process.env.GITHUB_TOKEN_4 ?? "" },
].filter((t) => t.value.length > 0);

const restStargazers = async (token: string): Promise<{ status: number; scopes: string; count: number }> => {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/stargazers?per_page=5`, {
    headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "starmapper-poc" },
  });
  const scopes = res.headers.get("x-oauth-scopes");
  const body = await res.json().catch(() => null);
  return { status: res.status, scopes: scopes === null ? "(fine-grained/none)" : scopes || "(empty)", count: Array.isArray(body) ? body.length : 0 };
};

const gqlStargazers = async (token: string): Promise<{ edges: number; error: string | null; total: number }> => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "starmapper-poc" },
    body: JSON.stringify({
      query: `{ repository(owner:"${OWNER}",name:"${REPO}"){ stargazerCount stargazers(first:5){ totalCount edges{ node{ login } } } } }`,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { repository?: { stargazerCount?: number; stargazers?: { edges?: unknown[] } } };
    errors?: Array<{ message?: string }>;
  };
  const edges = json.data?.repository?.stargazers?.edges?.length ?? 0;
  const total = json.data?.repository?.stargazerCount ?? 0;
  const error = json.errors?.[0]?.message ?? null;
  return { edges, error, total };
};

const main = async (): Promise<void> => {
  console.log(`\nPOC-F admin/OAuth stargazer exemption on ${OWNER}/${REPO}`);
  console.log(`${TOKENS.length} token(s) configured\n`);

  let anyAlive = false;
  for (const t of TOKENS) {
    const r = await restStargazers(t.value);
    const g = await gqlStargazers(t.value);
    const restVerdict = r.status === 200 && r.count > 0 ? "ALIVE" : r.status === 200 && r.count === 0 ? "empty200" : `dead(${r.status})`;
    const gqlVerdict = g.edges > 0 ? "ALIVE" : g.error ? "error" : "empty";
    if (restVerdict === "ALIVE" || gqlVerdict === "ALIVE") anyAlive = true;

    console.log(`${t.name}`);
    console.log(`  scopes (REST x-oauth-scopes): ${r.scopes}`);
    console.log(`  REST  /stargazers  : ${restVerdict}  (http ${r.status}, ${r.count} items)`);
    console.log(`  GraphQL stargazers : ${gqlVerdict}  (edges ${g.edges}, stargazerCount ${g.total}${g.error ? `, err: ${g.error.slice(0, 60)}` : ""})`);
    console.log("");
  }

  console.log("─".repeat(60));
  if (anyAlive) {
    console.log("RESULT: exemption WORKS for at least one token. OAuth path viable:");
    console.log("a repo owner who connects can map their own repos at 100%.");
  } else {
    console.log("RESULT: exemption dead for every token, including on the owned repo,");
    console.log("regardless of scopes. OAuth would not help today. Recheck later, the");
    console.log("rollout is intermittent and the exemption may activate.");
  }
  console.log("");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
