// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * index-engaged.ts
 *
 * Builds the engaged-audience map for repos and writes engaged_cache. The live
 * replacement for the dead stargazer scan: unions the surviving repo-to-users
 * channels (forks, issues, PRs, mentionables, watchers), geocodes through the
 * standard cascade, stores compressed points.
 *
 * Three target modes:
 *   <owner>/<repo>       one repo
 *   --input <file.json>  a JSON array of "owner/repo" (used by auto-index for new repos)
 *   --from-corpus        refresh existing repos (used by maintenance): picks from
 *                        stargazer_cache the entries missing or stale in engaged_cache
 *
 * Env must be sourced first (DATABASE_URL, GITHUB_TOKEN, geocoder keys). Run via the
 * make/pnpm wrappers, or:
 *   set -a && . ./.env.local && set +a && DATABASE_DRIVER=standard tsx scripts/ops/index-engaged.ts facebook/react
 *
 * Flags:
 *   --page-cap <N>    Max pages (100 users) per channel (default 20 = 2000/channel)
 *   --limit <N>       Max repos to process in --from-corpus mode (default 50)
 *   --stale-days <N>  In --from-corpus, re-index entries older than N days (default 30)
 *   --delay-ms <N>    Pause between repos in batch modes (default 500)
 *   --no-watch        Drop the fragile watchers channel
 *   --dry-run         Fetch + geocode, print stats, no DB write
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { compressToGzBase64 } from "@/lib/compression";
import { fetchEngagedAudience, ENGAGED_CHANNELS, type EngagedChannel, type GqlFetcher } from "@/lib/engaged-audience";
import { geocodeBatch } from "@/lib/geocoder";
import { prisma } from "@/lib/db";

const { values, positionals } = parseArgs({
  options: {
    input: { type: "string" },
    "from-corpus": { type: "boolean", default: false },
    "page-cap": { type: "string", default: "20" },
    limit: { type: "string", default: "50" },
    "stale-days": { type: "string", default: "30" },
    "delay-ms": { type: "string", default: "500" },
    "no-watch": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: true,
  args: process.argv.slice(2),
});

const pageCap = Math.max(1, parseInt(values["page-cap"] ?? "20", 10));
const limit = Math.max(1, parseInt(values.limit ?? "50", 10));
const staleDays = Math.max(0, parseInt(values["stale-days"] ?? "30", 10));
const delayMs = Math.max(0, parseInt(values["delay-ms"] ?? "500", 10));
const dryRun = values["dry-run"] === true;
const channels: EngagedChannel[] = values["no-watch"]
  ? ENGAGED_CHANNELS.filter((c) => c !== "watch")
  : [...ENGAGED_CHANNELS];

const TOKENS = [
  process.env.GITHUB_TOKEN,
  process.env.GITHUB_TOKEN_2,
  process.env.GITHUB_TOKEN_3,
  process.env.GITHUB_TOKEN_4,
].filter((t): t is string => Boolean(t && t.length > 0));

if (TOKENS.length === 0) {
  console.error("No GITHUB_TOKEN in env. Source .env.local first.");
  process.exit(1);
}

// Token-rotating GraphQL transport, injected into the pure fetch lib.
let tokenIdx = 0;
const fetcher: GqlFetcher = async (query) => {
  for (;;) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `bearer ${TOKENS[tokenIdx]}`, "content-type": "application/json", "user-agent": "starmapper-engaged" },
      body: JSON.stringify({ query }),
    });
    if ((res.status === 401 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) && tokenIdx < TOKENS.length - 1) {
      tokenIdx += 1;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown> | null; errors?: unknown[] };
    return { data: json.data ?? null, errors: json.errors };
  }
};

type EngagedPoint = { login: string; name: string | null; lat: number; lng: number; followers: number; channels: EngagedChannel[] };
type UnmappedEngaged = { login: string; name: string | null; followers: number; channels: EngagedChannel[]; location: string | null };
type RepoRef = { owner: string; repo: string };

/** Resolves the repo list from the active target mode. */
const resolveTargets = async (): Promise<RepoRef[]> => {
  if (values["from-corpus"]) {
    // Existing repos missing from engaged_cache or older than the staleness window.
    // Missing first (NULLS FIRST), then stalest. stargazer_cache is small (~2.6k rows).
    const rows = await prisma.$queryRaw<RepoRef[]>`
      SELECT sc.owner, sc.repo
      FROM stargazer_cache sc
      LEFT JOIN engaged_cache ec ON ec.owner = sc.owner AND ec.repo = sc.repo
      WHERE ec.owner IS NULL OR ec."scannedAt" < NOW() - make_interval(days => ${staleDays})
      ORDER BY ec."scannedAt" ASC NULLS FIRST
      LIMIT ${limit}
    `;
    return rows;
  }
  if (values.input) {
    const raw = JSON.parse(readFileSync(values.input, "utf8")) as string[];
    return raw
      .map((s) => s.split("/"))
      .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]) && Boolean(p[1]))
      .map(([owner, repo]) => ({ owner, repo }));
  }
  const target = positionals[0];
  if (!target || !target.includes("/")) return [];
  const [owner, repo] = target.split("/");
  return [{ owner: owner as string, repo: repo as string }];
};

type IndexResult = { mapped: number; known: number; starCount: number };

/** Fetches, geocodes and writes engaged_cache for one repo. */
const indexOne = async (owner: string, repo: string): Promise<IndexResult> => {
  const engaged = await fetchEngagedAudience(owner, repo, { fetcher, pageCap, channels });

  // geocodeBatch returns a Map keyed by the RAW location string (gotcha), so look
  // up with the verbatim value, never a normalized one.
  const locations = engaged.users.map((u) => u.location ?? "").filter((l) => l.length > 0);
  const geo = await geocodeBatch(locations);

  const points: EngagedPoint[] = [];
  const unmapped: UnmappedEngaged[] = [];
  for (const u of engaged.users) {
    const coords = u.location ? geo.get(u.location) ?? null : null;
    if (coords) {
      // Round to 2 decimals, same privacy convention as the stargazer path.
      points.push({ login: u.login, name: u.name, lat: Math.round(coords[0] * 100) / 100, lng: Math.round(coords[1] * 100) / 100, followers: u.followers, channels: u.channels });
    } else {
      unmapped.push({ login: u.login, name: u.name, followers: u.followers, channels: u.channels, location: u.location });
    }
  }

  const known = points.length + unmapped.length;
  const usedChannels = channels.filter((c) => !engaged.failedChannels.includes(c)).join(",");

  if (!dryRun) {
    const payload = {
      pointsGz: compressToGzBase64(points),
      unmappedGz: compressToGzBase64(unmapped),
      knownCount: known,
      starCount: engaged.starCount,
      channels: usedChannels,
    };
    await prisma.engagedCache.upsert({
      where: { owner_repo: { owner, repo } },
      create: { owner, repo, ...payload },
      update: { ...payload, scannedAt: new Date() },
    });
  }

  return { mapped: points.length, known, starCount: engaged.starCount };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async (): Promise<void> => {
  const targets = await resolveTargets();
  if (targets.length === 0) {
    console.error("No targets. Pass <owner>/<repo>, --input <file>, or --from-corpus.");
    process.exitCode = 1;
    return;
  }

  const mode = values["from-corpus"] ? "from-corpus" : values.input ? "input" : "single";
  console.log(`\nEngaged-audience index (${mode}): ${targets.length} repo(s)`);
  console.log(`  channels: ${channels.join(", ")}  pageCap: ${pageCap}  dryRun: ${dryRun}\n`);

  let done = 0;
  let totalMapped = 0;
  for (const { owner, repo } of targets) {
    const t0 = Date.now();
    try {
      const r = await indexOne(owner, repo);
      totalMapped += r.mapped;
      const rec = r.starCount > 0 ? ((r.mapped / r.starCount) * 100).toFixed(1) : "n/a";
      console.log(`  ✓ ${owner}/${repo}  ${r.mapped}/${r.known} mapped  (${rec}% of ${r.starCount} stars)  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`  ✗ ${owner}/${repo}  ${e instanceof Error ? e.message : String(e)}`);
    }
    done += 1;
    if (done < targets.length && delayMs > 0) await sleep(delayMs);
  }

  console.log(`\nDone. ${done} repo(s), ${totalMapped} mapped users total${dryRun ? " (dry-run, no writes)" : ""}.\n`);
};

main()
  .catch((e) => {
    console.error("Fatal:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
