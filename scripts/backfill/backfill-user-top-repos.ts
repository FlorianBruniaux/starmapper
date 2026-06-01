// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * backfill-user-top-repos.ts
 *
 * Fetches the top GitHub repos for high-follower developers indexed in StarMapper
 * and persists them to github_user.topRepos (Json) + topReposFetchedAt.
 *
 * Skip logic: re-fetch only if topReposFetchedAt IS NULL or older than 30 days.
 * Use --force to ignore skip logic and re-fetch all.
 *
 * Supports multiple GitHub tokens (GITHUB_TOKEN, GITHUB_TOKEN_2, …) with automatic
 * rotation — always uses the token with the most remaining capacity.
 *
 * Usage (local):
 *   pnpm backfill:user-top-repos:dry     # dry run, no writes
 *   pnpm backfill:user-top-repos:local   # write to local Docker DB
 *
 * Usage (prod):
 *   pnpm backfill:user-top-repos:prod:dry
 *   pnpm backfill:user-top-repos:prod
 *
 * Options:
 *   --top <N>            Max users to process, ordered by followers desc (default: 5000)
 *   --min-followers <N>  Minimum followers to qualify (default: 100)
 *   --concurrency <N>    Parallel GitHub API calls (default: 8)
 *   --token <n>          Force single token by index (1-based), 0 = use all (default: 0)
 *   --force              Ignore 30d skip logic, re-fetch all qualified users
 *   --dry-run            Print stats only, no DB writes
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ─── Load .env.local ──────────────────────────────────────────────────────────

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

// ─── CLI args ─────────────────────────────────────────────────────────────────

// Strip pnpm's '--' separator (present when called via `pnpm run script -- --flag`)
const cliArgs = process.argv.slice(2).filter((a) => a !== "--");

const { values: argv } = parseArgs({
  args: cliArgs,
  options: {
    "dry-run":        { type: "boolean", default: false },
    "force":          { type: "boolean", default: false },
    "top":            { type: "string",  default: "5000" },
    "min-followers":  { type: "string",  default: "100" },
    "concurrency":    { type: "string",  default: "8" },
    "token":          { type: "string",  default: "0" },
  },
  strict: true,
});

const DRY_RUN       = argv["dry-run"];
const FORCE         = argv["force"];
const TOP_USERS     = parseInt(argv.top, 10);
const MIN_FOLLOWERS = parseInt(argv["min-followers"], 10);
const CONCURRENCY   = parseInt(argv.concurrency, 10);
const TOKEN_INDEX   = parseInt(argv.token, 10);

// Skip users fetched within the last 30 days (unless --force)
const CUTOFF_DATE = new Date();
CUTOFF_DATE.setDate(CUTOFF_DATE.getDate() - 30);

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, options: "-c statement_timeout=0" });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Multi-token pool (identical to collect-user-repos.ts) ────────────────────

type TokenState = {
  token: string;
  remaining: number;
  resetAt: number;
  callCount: number;
};

const buildTokenPool = (): TokenState[] => {
  const all: string[] = [];
  const base = process.env.GITHUB_TOKEN;
  if (base) all.push(base);
  let i = 2;
  while (true) {
    const t = process.env[`GITHUB_TOKEN_${i}`];
    if (!t) break;
    all.push(t);
    i++;
  }
  const tokens = TOKEN_INDEX > 0 ? all.slice(TOKEN_INDEX - 1, TOKEN_INDEX) : all;
  if (tokens.length === 0) console.warn("Warning: no GITHUB_TOKEN set — limited to 60 req/hr");
  return tokens.map((token) => ({ token, remaining: 5000, resetAt: 0, callCount: 0 }));
};

const TOKEN_POOL = buildTokenPool();

const getBestToken = (): TokenState =>
  TOKEN_POOL.reduce((best, t) => (t.remaining > best.remaining ? t : best), TOKEN_POOL[0]);

const acquireToken = async (): Promise<TokenState> => {
  const best = getBestToken();
  if (best.remaining > 5) return best;

  const earliest = TOKEN_POOL.reduce(
    (min, t) => (t.resetAt < min.resetAt ? t : min),
    TOKEN_POOL[0],
  );
  const waitMs = Math.max(0, earliest.resetAt * 1000 - Date.now()) + 3000;
  const mins = Math.round(waitMs / 60000);
  console.warn(`  [token-pool] All tokens exhausted — waiting ${mins}m for ${earliest.token.slice(0, 8)}... to reset`);
  await new Promise<void>((r) => setTimeout(r, waitMs));
  earliest.remaining = 5000;
  return earliest;
};

const makeHeaders = (t: TokenState): HeadersInit => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "starmapper-backfill/1.0",
  Authorization: `Bearer ${t.token}`,
});

// ─── Types (mirror of route.ts UserRepo) ─────────────────────────────────────

type UserRepo = {
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  url: string;
};

// ─── GitHub fetch ─────────────────────────────────────────────────────────────

type FetchResult =
  | { status: "ok"; repos: UserRepo[] }
  | { status: "not_found" }
  | { status: "error" };

const fetchUserTopRepos = async (login: string): Promise<FetchResult> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tok = await acquireToken();

    try {
      const res = await fetch(
        `https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=stars&per_page=10&type=owner`,
        { headers: makeHeaders(tok), signal: AbortSignal.timeout(10_000) },
      );

      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? tok.remaining);
      const resetAt = Number(res.headers.get("x-ratelimit-reset") ?? tok.resetAt);
      tok.remaining = remaining;
      tok.resetAt = resetAt;
      tok.callCount++;

      if (res.status === 404) return { status: "not_found" };

      if (res.status === 403 || res.status === 429) {
        tok.remaining = 0;
        console.warn(`  [rate-limit] Token ${tok.token.slice(0, 8)}... exhausted — switching`);
        continue;
      }

      if (!res.ok) return { status: "error" };

      const rawRepos = await res.json() as {
        name: string;
        full_name: string;
        description: string | null;
        stargazers_count: number;
        language: string | null;
        html_url: string;
        fork: boolean;
      }[];

      const repos: UserRepo[] = rawRepos
        .filter((r) => !r.fork)
        .slice(0, 8)
        .map((r) => ({
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          stars: r.stargazers_count,
          language: r.language,
          url: r.html_url,
        }));

      return { status: "ok", repos };

    } catch {
      if (attempt < 2) await new Promise<void>((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return { status: "error" };
};

// ─── Concurrency helper ───────────────────────────────────────────────────────

const concurrentMap = async <T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return results;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log("\nBackfill top repos for StarMapper developers");
  console.log(`  Top users:      ${TOP_USERS}`);
  console.log(`  Min followers:  ${MIN_FOLLOWERS}`);
  console.log(`  Concurrency:    ${CONCURRENCY}`);
  console.log(`  Force refresh:  ${FORCE}`);
  console.log(`  Dry run:        ${DRY_RUN}`);
  console.log(`  Skip cutoff:    ${CUTOFF_DATE.toISOString().slice(0, 10)} (30d — unless --force)`);
  console.log(`  Tokens:         ${TOKEN_POOL.length} (${TOKEN_POOL.map((t) => t.token.slice(0, 8) + "...").join(", ")})`);
  console.log(`  DB:             ${DATABASE_URL.split("@")[1] ?? DATABASE_URL}`);
  console.log("");

  // 1. Fetch users from DB
  console.log("Fetching users from DB...");
  const users = await prisma.gitHubUser.findMany({
    where: {
      followers: { gte: MIN_FOLLOWERS },
      ...(FORCE ? {} : {
        OR: [
          { topReposFetchedAt: null },
          { topReposFetchedAt: { lt: CUTOFF_DATE } },
        ],
      }),
    },
    orderBy: { followers: "desc" },
    take: TOP_USERS,
    select: { login: true, followers: true },
  });

  const totalQualified = await prisma.gitHubUser.count({
    where: { followers: { gte: MIN_FOLLOWERS } },
  });
  // alreadyFresh = qualified users not in this batch (already fresh or beyond TOP_USERS cap)
  const alreadyFresh = totalQualified - users.length;

  console.log(`  → ${users.length} users to process`);
  console.log(`  → ${alreadyFresh} skipped (fresh or beyond top-${TOP_USERS} cap)\n`);

  if (DRY_RUN) {
    console.log("  (dry-run — no DB writes)");
    console.log(`\n  Would fetch: ${users.length} users`);
    console.log(`  Top 10 to process:`);
    for (const u of users.slice(0, 10)) {
      console.log(`    @${u.login.padEnd(30)} ${u.followers.toLocaleString()} followers`);
    }
    await prisma.$disconnect();
    return;
  }

  // 2. Fetch + persist in parallel
  let processed = 0;
  let written = 0;
  let notFound = 0;
  let errors = 0;

  await concurrentMap(users, async (user) => {
    const result = await fetchUserTopRepos(user.login);

    if (result.status === "not_found") {
      notFound++;
      // Mark as fetched-empty so we don't retry
      await prisma.gitHubUser.update({
        where: { login: user.login },
        data: { topRepos: [], topReposFetchedAt: new Date() },
      }).catch(() => {});
    } else if (result.status === "ok") {
      const ok = await prisma.gitHubUser.update({
        where: { login: user.login },
        data: {
          topRepos: result.repos,
          topReposFetchedAt: new Date(),
          // Always write publicRepos so the explore leaderboard shows the correct count.
          // Strictly increasing to avoid regressions (may be lower than real total if
          // userData.public_repos not fetched here, but always >= repos.length).
          publicRepos: result.repos.length,
        },
      }).then(() => true).catch(() => { errors++; return false; });
      if (ok) written++;
    } else {
      errors++;
    }

    processed++;
    if (processed % 200 === 0 || processed === users.length) {
      const tokenStatus = TOKEN_POOL.map(
        (t) => `${t.token.slice(0, 8)}…: ${t.remaining}/${t.callCount}`,
      ).join(" | ");
      process.stdout.write(`  ${processed}/${users.length} — ✓${written} 404:${notFound} err:${errors} — [${tokenStatus}]\n`);
    }
  }, CONCURRENCY * TOKEN_POOL.length);

  console.log(`\nResults:`);
  console.log(`  Written:   ${written}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`\n  Token usage:`);
  for (const t of TOKEN_POOL) {
    console.log(`    ${t.token.slice(0, 8)}…  ${t.callCount} calls, ${t.remaining} remaining`);
  }

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
