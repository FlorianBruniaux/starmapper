// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * collect-trending-repos.ts
 *
 * Fetches popular GitHub repos via the Search API — independent of which
 * developers are already indexed in StarMapper. Complements collect-user-repos.ts
 * by catching repos owned by accounts with few followers.
 *
 * Strategy: paginate across 3 star ranges to bypass the 1000-result API cap.
 *   stars:>=10000  pushed:>CUTOFF  → global top repos
 *   stars:1000..9999               → mid-tier active repos
 *   stars:100..999                 → smaller repos gaining traction
 *
 * Supports multiple GitHub tokens (GITHUB_TOKEN, GITHUB_TOKEN_2, GITHUB_TOKEN_3…)
 * with automatic rotation on rate limit.
 *
 * Usage:
 *   DATABASE_URL=postgresql://starmapper:starmapper@localhost:5433/starmapper \
 *   GITHUB_TOKEN=ghp_xxx GITHUB_TOKEN_2=ghp_yyy \
 *   pnpm collect:trending [options]
 *
 * Options:
 *   --min-stars <N>      Only include repos with at least N stars (default: 100)
 *   --since-months <N>   Only repos pushed in the last N months (default: 12)
 *   --language <lang>    Filter by language (e.g. "rust", "go", "haskell") — can be repeated
 *   --exclude-language <lang>  Exclude a language — can be repeated
 *   --output <path>      Output file path (default: scripts/repos-trending.json)
 *   --dry-run            Print stats only, don't write file
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

const MIN_STARS    = parseInt(getArg("--min-stars", "100"), 10);
const SINCE_MONTHS = parseInt(getArg("--since-months", "12"), 10);
const OUTPUT_FILE  = getArg("--output", "scripts/repos-trending.json");
// --token <n>  Force a single token by index (1 = GITHUB_TOKEN, 2 = GITHUB_TOKEN_2, …)
const TOKEN_INDEX  = parseInt(getArg("--token", "0"), 10); // 0 = use all

// --language <lang>  Filter by language (repeatable)
const getArgs = (flag: string): string[] => {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1]) result.push(argv[i + 1]);
  }
  return result;
};
const LANGUAGES         = getArgs("--language");
const EXCLUDE_LANGUAGES = getArgs("--exclude-language");

const CUTOFF_DATE = new Date();
CUTOFF_DATE.setMonth(CUTOFF_DATE.getMonth() - SINCE_MONTHS);
const CUTOFF_ISO = CUTOFF_DATE.toISOString().slice(0, 10); // YYYY-MM-DD

const DATABASE_URL = process.env.DATABASE_URL ?? "";

if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Star ranges (3 bands to bypass the 1000-result API cap) ─────────────────

type StarRange = { label: string; q: string };

const buildRanges = (): StarRange[] => {
  const ranges: StarRange[] = [
    { label: "stars ≥ 10k",    q: `stars:>=10000` },
    { label: "stars 1k–9.9k",  q: `stars:1000..9999` },
    { label: "stars 100–999",  q: `stars:100..999` },
  ];
  // Drop ranges entirely below MIN_STARS
  return ranges.filter((r) => {
    if (r.q.startsWith("stars:>=")) return MIN_STARS <= parseInt(r.q.slice(8), 10);
    const parts = r.q.slice(6).split("..");
    return MIN_STARS <= parseInt(parts[1] ?? "0", 10);
  });
};

// ─── Multi-token pool ─────────────────────────────────────────────────────────

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
  // --token <n>: keep only the nth token (1-based), to run multiple instances in parallel
  const tokens = TOKEN_INDEX > 0 ? all.slice(TOKEN_INDEX - 1, TOKEN_INDEX) : all;
  if (tokens.length === 0) console.warn("Warning: no GITHUB_TOKEN — search limited to 10 req/min");
  return tokens.map((token) => ({ token, remaining: 30, resetAt: 0, callCount: 0 }));
};

const TOKEN_POOL = buildTokenPool();

const getBestToken = (): TokenState =>
  TOKEN_POOL.reduce((best, t) => t.remaining > best.remaining ? t : best, TOKEN_POOL[0]);

const acquireToken = async (): Promise<TokenState> => {
  const best = getBestToken();
  if (best.remaining > 1) return best;

  const earliest = TOKEN_POOL.reduce(
    (min, t) => t.resetAt < min.resetAt ? t : min,
    TOKEN_POOL[0],
  );
  const waitMs = Math.max(0, earliest.resetAt * 1000 - Date.now()) + 3000;
  const secs = Math.round(waitMs / 1000);
  console.warn(`  [token-pool] All tokens exhausted — waiting ${secs}s for ${earliest.token.slice(0, 8)}... to reset`);
  await new Promise<void>((r) => setTimeout(r, waitMs));
  earliest.remaining = 30;
  return earliest;
};

const makeHeaders = (t: TokenState): HeadersInit => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "starmapper-trending/1.0",
  Authorization: `Bearer ${t.token}`,
});

// ─── Sleep helper ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Fetch one page from Search API ──────────────────────────────────────────

type SearchRepo = { fullName: string; stars: number };

const fetchSearchPage = async (
  starsQ: string,
  page: number,
): Promise<{ repos: SearchRepo[]; totalCount: number; incomplete: boolean } | null> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const tok = await acquireToken();

    const langFilter = LANGUAGES.map((l) => `language:${l}`).join(" ");
    const q = encodeURIComponent(
      `${starsQ} pushed:>${CUTOFF_ISO} fork:false archived:false${langFilter ? " " + langFilter : ""}`,
    );
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`;

    try {
      const res = await fetch(url, {
        headers: makeHeaders(tok),
        signal: AbortSignal.timeout(15_000),
      });

      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? tok.remaining);
      const resetAt   = Number(res.headers.get("x-ratelimit-reset")     ?? tok.resetAt);
      tok.remaining = remaining;
      tok.resetAt   = resetAt;
      tok.callCount++;

      if (res.status === 403 || res.status === 429) {
        tok.remaining = 0;
        console.warn(`  [rate-limit] Token ${tok.token.slice(0, 8)}... exhausted — switching`);
        // Search API secondary rate limit — wait a bit before retrying
        await sleep(10_000);
        continue;
      }

      if (res.status === 422) {
        // Validation error (e.g. page > 10) — stop paginating this range
        return null;
      }

      if (!res.ok) {
        console.warn(`  [search] HTTP ${res.status} on page ${page}`);
        return null;
      }

      const body = await res.json() as {
        total_count: number;
        incomplete_results: boolean;
        items: { full_name: string; stargazers_count: number; language: string | null }[];
      };

      const items = body.items
        .filter((r) => {
          if (EXCLUDE_LANGUAGES.length === 0) return true;
          const lang = (r.language ?? "").toLowerCase();
          return !EXCLUDE_LANGUAGES.map((l) => l.toLowerCase()).includes(lang);
        })
        .map((r) => ({ fullName: r.full_name, stars: r.stargazers_count }));

      return {
        repos: items,
        totalCount: body.total_count,
        incomplete: body.incomplete_results,
      };
    } catch {
      if (attempt < 2) await sleep(5000 * (attempt + 1));
    }
  }
  return null;
};

// ─── Fetch all pages for a star range (max 10 pages = 1000 results) ──────────

const fetchRange = async (range: StarRange): Promise<SearchRepo[]> => {
  const repos: SearchRepo[] = [];
  console.log(`\n  Range: ${range.label}  (q: ${range.q} pushed:>${CUTOFF_ISO})`);

  for (let page = 1; page <= 10; page++) {
    // Search API secondary rate limit: ≤1 req/s recommended
    if (page > 1) await sleep(1200);

    const result = await fetchSearchPage(range.q, page);
    if (!result || result.repos.length === 0) break;

    repos.push(...result.repos);

    const tokenStatus = TOKEN_POOL.map(
      (t) => `${t.token.slice(0, 8)}…: ${t.remaining} rem`,
    ).join(" | ");

    process.stdout.write(
      `    page ${page}/10 — ${result.repos.length} repos — total so far: ${repos.length}` +
      (result.incomplete ? " ⚠ incomplete" : "") +
      ` — [${tokenStatus}]\n`,
    );

    // If this page returned fewer than 100 items, we've reached the end
    if (result.repos.length < 100) break;

    // If total results > 1000, we can only get the first 1000 via pagination
    if (result.totalCount > 1000 && page === 1) {
      console.log(`    → ${result.totalCount.toLocaleString()} total matches (API cap: 1000)`);
    }
  }

  return repos;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const ranges = buildRanges();

  console.log("\nCollect trending repos via GitHub Search API");
  console.log(`  Min stars:    ${MIN_STARS}`);
  console.log(`  Since months: ${SINCE_MONTHS} (cutoff: ${CUTOFF_ISO})`);
  console.log(`  Star ranges:  ${ranges.map((r) => r.label).join(", ")}`);
  if (LANGUAGES.length)         console.log(`  Languages:    ${LANGUAGES.join(", ")}`);
  if (EXCLUDE_LANGUAGES.length) console.log(`  Exclude:      ${EXCLUDE_LANGUAGES.join(", ")}`);
  console.log(`  Tokens:       ${TOKEN_POOL.length} (${TOKEN_POOL.map((t) => t.token.slice(0, 8) + "...").join(", ")})`);
  console.log(`  DB:           ${DATABASE_URL.split("@")[1] ?? DATABASE_URL}`);
  console.log("");

  // 1. Load already-scanned repos
  console.log("Loading already-scanned repos from badge_cache...");
  const scanned = await prisma.badgeCache.findMany({ select: { owner: true, repo: true } });
  const scannedSet = new Set(scanned.map((r) => `${r.owner}/${r.repo}`));
  console.log(`  → ${scannedSet.size} repos already scanned (will skip)`);

  // 2. Fetch all ranges
  const repoScores = new Map<string, number>();

  for (const range of ranges) {
    const repos = await fetchRange(range);
    for (const r of repos) {
      if (r.stars >= MIN_STARS) {
        const key = r.fullName.toLowerCase();
        if ((repoScores.get(key) ?? 0) < r.stars) repoScores.set(key, r.stars);
      }
    }
  }

  // 3. Filter + sort
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

  // Token usage
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
    console.log(`  # Merge with collect-user-repos output then scan:`);
    console.log(`  node -e "const a=require('./scripts/repos-from-users.json'),b=require('./scripts/repos-trending.json'),m=[...new Set([...a,...b])];require('fs').writeFileSync('scripts/repos-all.json',JSON.stringify(m,null,2));console.log('Merged:',m.length,'repos')"`);
    console.log(`  pnpm batch:scan --input scripts/repos-all.json`);
  }

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
