// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * collect-user-repos.ts
 *
 * Fetches the GitHub repos of the top developers indexed in StarMapper,
 * filters out repos already scanned, and writes a JSON list ready for batch-scan.
 *
 * Supports multiple GitHub tokens (GITHUB_TOKEN, GITHUB_TOKEN_2, GITHUB_TOKEN_3...)
 * with automatic rotation: always uses the token with the most remaining capacity,
 * waits for the earliest reset when all are exhausted.
 *
 * Usage:
 *   DATABASE_URL=postgresql://starmapper:starmapper@localhost:5433/starmapper \
 *   GITHUB_TOKEN=ghp_xxx GITHUB_TOKEN_2=ghp_yyy GITHUB_TOKEN_3=ghp_zzz \
 *   pnpm collect:repos [options]
 *
 * Options:
 *   --top <N>          Take top N developers by followers (default: 1000)
 *   --min-stars <N>    Only include repos with at least N stars (default: 100)
 *   --per-user <N>     Max repos to collect per user (default: 20)
 *   --output <path>    Output file path (default: scripts/repos-from-users.json)
 *   --dry-run          Print stats only, don't write file
 *   --concurrency <N>  Parallel GitHub API calls per token (default: 8)
 */

import { readFileSync, writeFileSync } from "fs";
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

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

const getArg = (flag: string, fallback: string) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const TOP_USERS    = parseInt(getArg("--top", "1000"), 10);
const MIN_STARS    = parseInt(getArg("--min-stars", "100"), 10);
const PER_USER     = parseInt(getArg("--per-user", "20"), 10);
const SINCE_MONTHS = parseInt(getArg("--since-months", "12"), 10);
const CONCURRENCY  = parseInt(getArg("--concurrency", "8"), 10);
const OUTPUT_FILE  = getArg("--output", "scripts/repos-from-users.json");
// --token <n>  Force a single token by index (1 = GITHUB_TOKEN, 2 = GITHUB_TOKEN_2, …)
// Useful to run multiple instances in parallel each with a dedicated token.
const TOKEN_INDEX  = parseInt(getArg("--token", "0"), 10); // 0 = use all

// Cutoff date: only repos pushed after this date
const CUTOFF_DATE = new Date();
CUTOFF_DATE.setMonth(CUTOFF_DATE.getMonth() - SINCE_MONTHS);

const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Multi-token pool ─────────────────────────────────────────────────────────

type TokenState = {
  token: string;
  remaining: number;
  resetAt: number; // unix seconds
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
  // --token <n>: keep only the nth token (1-based), to run multiple instances in parallel
  const tokens = TOKEN_INDEX > 0 ? all.slice(TOKEN_INDEX - 1, TOKEN_INDEX) : all;
  if (tokens.length === 0) console.warn("Warning: no GITHUB_TOKEN set — limited to 60 req/hr");
  return tokens.map((token) => ({
    token,
    remaining: 5000,
    resetAt: 0,
    callCount: 0,
  }));
};

const TOKEN_POOL = buildTokenPool();

/** Returns the token state with the highest remaining capacity. */
const getBestToken = (): TokenState => {
  return TOKEN_POOL.reduce((best, t) => t.remaining > best.remaining ? t : best, TOKEN_POOL[0]);
};

/** Waits until at least one token has capacity, then returns it. */
const acquireToken = async (): Promise<TokenState> => {
  const best = getBestToken();
  if (best.remaining > 5) return best;

  // All tokens near exhaustion — wait for the earliest reset
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
  "User-Agent": "starmapper-collect/1.0",
  Authorization: `Bearer ${t.token}`,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── GitHub fetch (with token rotation) ──────────────────────────────────────

const fetchUserRepos = async (login: string): Promise<{ fullName: string; stars: number }[]> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tok = await acquireToken();

    try {
      const res = await fetch(
        `https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=stars&per_page=${PER_USER}&type=owner`,
        { headers: makeHeaders(tok), signal: AbortSignal.timeout(10_000) },
      );

      // Update token rate limit state from response headers
      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? tok.remaining);
      const resetAt = Number(res.headers.get("x-ratelimit-reset") ?? tok.resetAt);
      tok.remaining = remaining;
      tok.resetAt = resetAt;
      tok.callCount++;

      if (res.status === 404) return [];

      if (res.status === 403 || res.status === 429) {
        // Mark this token as exhausted, retry with a different one
        tok.remaining = 0;
        console.warn(`  [rate-limit] Token ${tok.token.slice(0, 8)}... exhausted — switching`);
        continue;
      }

      if (!res.ok) return [];

      const repos = await res.json() as {
        full_name: string;
        stargazers_count: number;
        fork: boolean;
        archived: boolean;
        private: boolean;
        pushed_at: string;
      }[];

      return repos
        .filter((r) => !r.fork && !r.archived && !r.private && new Date(r.pushed_at) >= CUTOFF_DATE)
        .map((r) => ({ fullName: r.full_name, stars: r.stargazers_count }));

    } catch {
      if (attempt < 2) await sleep(3000 * (attempt + 1));
    }
  }
  return [];
};

// ─── Parallel map with concurrency limit ─────────────────────────────────────

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
  const totalCapacity = TOKEN_POOL.length * 5000;

  console.log("\nCollect repos from top StarMapper developers");
  console.log(`  Top users:    ${TOP_USERS}`);
  console.log(`  Min stars:    ${MIN_STARS}`);
  console.log(`  Per user:     ${PER_USER}`);
  console.log(`  Since months: ${SINCE_MONTHS} (cutoff: ${CUTOFF_DATE.toISOString().slice(0, 10)})`);
  console.log(`  Concurrency:  ${CONCURRENCY}`);
  console.log(`  Tokens:       ${TOKEN_POOL.length} (${TOKEN_POOL.map((t) => t.token.slice(0, 8) + "...").join(", ")})`);
  console.log(`  Total budget: ~${totalCapacity.toLocaleString()} req/hr`);
  console.log(`  DB:           ${DATABASE_URL.split("@")[1] ?? DATABASE_URL}`);
  console.log("");

  // 1. Fetch top developers from DB
  console.log(`Fetching top ${TOP_USERS} developers from DB...`);
  const users = await prisma.gitHubUser.findMany({
    orderBy: { followers: "desc" },
    take: TOP_USERS,
    select: { login: true, followers: true },
  });
  console.log(`  → ${users.length} users loaded\n`);

  // 2. Load already-scanned repos
  console.log("Loading already-scanned repos from badge_cache...");
  const scanned = await prisma.badgeCache.findMany({ select: { owner: true, repo: true } });
  const scannedSet = new Set(scanned.map((r) => `${r.owner}/${r.repo}`));
  console.log(`  → ${scannedSet.size} repos already scanned (will skip)\n`);

  // 3. Fetch repos in parallel
  const eta = Math.ceil(users.length / CONCURRENCY / TOKEN_POOL.length);
  console.log(`Fetching repos from GitHub API... (est. ~${eta}s at concurrency ${CONCURRENCY}×${TOKEN_POOL.length} tokens)`);

  const repoScores = new Map<string, number>();
  let processed = 0;

  await concurrentMap(users, async (user) => {
    const repos = await fetchUserRepos(user.login);
    for (const r of repos) {
      if (r.stars >= MIN_STARS) {
        const key = r.fullName.toLowerCase();
        if ((repoScores.get(key) ?? 0) < r.stars) repoScores.set(key, r.stars);
      }
    }
    processed++;
    if (processed % 100 === 0 || processed === users.length) {
      const tokenStatus = TOKEN_POOL.map((t) => `${t.token.slice(0, 8)}…: ${t.remaining}/${t.callCount} calls`).join(" | ");
      process.stdout.write(`  ${processed}/${users.length} — ${repoScores.size} repos found — [${tokenStatus}]\n`);
    }
  }, CONCURRENCY * TOKEN_POOL.length);

  // 4. Filter + sort
  const sorted = [...repoScores.entries()].sort((a, b) => b[1] - a[1]);
  const newRepos = sorted.filter(([name]) => !scannedSet.has(name));
  const alreadyScanned = sorted.length - newRepos.length;

  console.log(`\nResults:`);
  console.log(`  Unique repos found:        ${sorted.length}`);
  console.log(`  Already scanned (skipped): ${alreadyScanned}`);
  console.log(`  New repos to scan:         ${newRepos.length}`);
  console.log(`\n  Top 15 new repos by stars:`);
  for (const [name, stars] of newRepos.slice(0, 15)) {
    console.log(`    ${name.padEnd(55)} ${stars.toLocaleString()} ★`);
  }

  // Token usage summary
  console.log(`\n  Token usage:`);
  for (const t of TOKEN_POOL) {
    console.log(`    ${t.token.slice(0, 8)}…  ${t.callCount} calls, ${t.remaining} remaining`);
  }

  if (DRY_RUN) {
    console.log("\n  (dry-run — no file written)");
  } else {
    const output = newRepos.map(([name]) => {
      const slash = name.indexOf("/");
      return `${name.slice(0, slash)}/${name.slice(slash + 1)}`;
    });
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(`\n  Written: ${OUTPUT_FILE} (${output.length} repos)`);
    console.log(`\nNext steps:`);
    console.log(`  # Scan with all 3 tokens in parallel — split the list first if needed:`);
    console.log(`  DATABASE_URL=postgresql://starmapper:starmapper@localhost:5433/starmapper \\`);
    console.log(`  GITHUB_TOKEN=\${GITHUB_TOKEN} GITHUB_TOKEN_2=\${GITHUB_TOKEN_2} GITHUB_TOKEN_3=\${GITHUB_TOKEN_3} \\`);
    console.log(`  pnpm batch:scan --input ${OUTPUT_FILE}`);
    console.log(`\n  # After scan, sync to Neon:`);
    console.log(`  ./scripts/db-sync-to-neon.sh`);
  }

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
