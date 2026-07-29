// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * backfill-languages.ts
 *
 * Fetches tech languages for github_user rows where languagesFetchedAt IS NULL.
 * Uses repositories(ownerAffiliations: OWNER, isFork: false) — the user's own
 * non-fork repos ordered by last updated. Much cheaper than contributionsCollection
 * (no contribution history scan → no "Resource limits exceeded" errors).
 *
 * Languages are stored as a String[] sorted by frequency desc, e.g.:
 *   ["TypeScript", "Python", "Rust"]
 *
 * Ghost/deleted users receive languages=[] but languagesFetchedAt is still set —
 * they are never retried.
 *
 * Usage:
 *   pnpm backfill:languages [options]
 *
 * Options:
 *   --prod                Target Neon prod (default: local Docker)
 *   --min-followers <N>   Only process users with at least N followers (default: 0)
 *   --top <N>             Only process top N users by followers (default: all)
 *   --cursor <login>      Resume from this login (followers desc, login asc order)
 *   --batch <N>           Users per GraphQL request (default: 50, max: 50)
 *   --force               Re-fetch even if languagesFetchedAt is already set
 *   --since <N>           Re-fetch users whose languagesFetchedAt is older than N days
 *                         (also processes users with languagesFetchedAt IS NULL)
 *   --dry-run             Query GitHub but don't write to DB
 *   --from-cache          Pre-fill languages from star_event + badge_cache (no API calls)
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "../lib/pg-pool";

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

const { values: argv } = parseArgs({
  options: {
    "dry-run":       { type: "boolean", default: false },
    "prod":          { type: "boolean", default: false },
    "force":         { type: "boolean", default: false },
    "from-cache":    { type: "boolean", default: false },
    "top":           { type: "string",  default: "0" },
    "min-followers": { type: "string",  default: "0" },
    "batch":         { type: "string",  default: "30" },
    "cursor":        { type: "string",  default: "" },
    "token-index":   { type: "string",  default: "-1" },
    "since":         { type: "string",  default: "0" },
  },
  strict: true,
});

const DRY_RUN       = argv["dry-run"];
const USE_PROD      = argv.prod;
const FORCE         = argv.force;
const FROM_CACHE    = argv["from-cache"];
const TOP_USERS     = parseInt(argv.top,            10); // 0 = all
const MIN_FOLLOWERS = parseInt(argv["min-followers"], 10); // 0 = all
const BATCH_SIZE    = Math.min(parseInt(argv.batch,  10), 50);
const START_CURSOR  = argv.cursor;
const TOKEN_INDEX   = parseInt(argv["token-index"],  10); // -1 = all tokens
const SINCE_DAYS    = parseInt(argv.since,           10); // 0 = disabled

const DB_URL = USE_PROD
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) { console.error("Error: no DB URL found"); process.exit(1); }

const pool   = createScriptPool(DB_URL, { options: "-c statement_timeout=0" });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Multi-token pool ─────────────────────────────────────────────────────────

type TokenState = { token: string; remaining: number; resetAt: number; callCount: number };

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
  if (all.length === 0) { console.error("Error: no GITHUB_TOKEN set"); process.exit(1); }
  const filtered = TOKEN_INDEX >= 0 ? all.filter((_, idx) => idx === TOKEN_INDEX) : all;
  if (filtered.length === 0) { console.error(`Error: --token-index ${TOKEN_INDEX} out of range (${all.length} tokens)`); process.exit(1); }
  return filtered.map((token) => ({ token, remaining: 5000, resetAt: 0, callCount: 0 }));
};

const TOKEN_POOL = buildTokenPool();

const acquireToken = async (): Promise<TokenState> => {
  const best = TOKEN_POOL.reduce((b, t) => t.remaining > b.remaining ? t : b, TOKEN_POOL[0]);
  if (best.remaining > 5) return best;
  const earliest = TOKEN_POOL.reduce((m, t) => t.resetAt < m.resetAt ? t : m, TOKEN_POOL[0]);
  const waitMs = Math.max(0, earliest.resetAt * 1000 - Date.now()) + 3000;
  console.warn(`  [token-pool] All exhausted — waiting ${Math.round(waitMs / 60000)}m`);
  await new Promise<void>((r) => setTimeout(r, waitMs));
  earliest.remaining = 5000;
  return earliest;
};

// ─── Language computation ─────────────────────────────────────────────────────

/**
 * Given a list of raw language names (may contain nulls), returns a deduplicated
 * array sorted by frequency desc, then alphabetically for ties.
 *
 * computeLanguages(["TypeScript", "Python", "TypeScript", null, "Python", "Rust"])
 *   → ["Python", "TypeScript", "Rust"]
 */
const computeLanguages = (rawLangs: (string | null | undefined)[]): string[] => {
  const counts = new Map<string, number>();
  for (const l of rawLangs) {
    if (!l) continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
};

// ─── GitHub GraphQL — repositories batch (cheap: no contribution scan) ────────

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

type BatchResult = { login: string; languages: string[] };

const fetchLanguagesBatch = async (logins: string[]): Promise<BatchResult[]> => {
  const tok = await acquireToken();

  // Aliased batch — u0, u1, ... uN
  // Uses repositories(ownerAffiliations: OWNER) — much cheaper than contributionsCollection.
  // No contribution history scan → no "Resource limits exceeded" errors.
  // Trade-off: only captures languages from user's own repos (not OSS contributions),
  // but covers the vast majority of devs and is 10x cheaper in GraphQL points.
  const aliases = logins
    .map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) {
      repositories(first: 10, ownerAffiliations: OWNER, orderBy: {field: UPDATED_AT, direction: DESC}, isFork: false) {
        nodes { primaryLanguage { name } }
      }
    }`)
    .join("\n");

  const query = `query { ${aliases} }`;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tok.token}`,
      "User-Agent": "starmapper-backfill/1.0",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });

  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? tok.remaining);
  const resetAt   = Number(res.headers.get("x-ratelimit-reset")     ?? tok.resetAt);
  tok.remaining = remaining;
  tok.resetAt   = resetAt;
  tok.callCount++;

  if (res.status === 403 || res.status === 429) {
    tok.remaining = 0;
    throw new Error(`rate_limited token=${tok.token.slice(0, 8)}`);
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);

  const json = await res.json() as {
    data?: Record<string, unknown>;
    errors?: { message: string; path?: string[] }[];
  };

  // Log per-user errors without throwing — partial data is still usable
  if (json.errors?.length) {
    for (const e of json.errors) {
      console.warn(`  [graphql-error] ${e.message}${e.path ? ` (${e.path.join(".")})` : ""}`);
    }
    // Throw only if data is completely missing (rate limit or auth error)
    if (!json.data) throw new Error(json.errors[0].message);
  }

  const results: BatchResult[] = [];

  for (let i = 0; i < logins.length; i++) {
    const userData = json.data?.[`u${i}`] as {
      repositories?: {
        nodes: Array<{ primaryLanguage: { name: string } | null } | null>;
      };
    } | null | undefined;

    if (userData === null || userData === undefined) {
      // Ghost/deleted/suspended user — mark as processed with empty languages
      results.push({ login: logins[i], languages: [] });
      continue;
    }

    const rawLangs = (userData.repositories?.nodes ?? [])
      .map((n) => n?.primaryLanguage?.name ?? null);

    results.push({
      login: logins[i],
      languages: computeLanguages(rawLangs),
    });
  }

  return results;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const formatEta = (processedSoFar: number, total: number, elapsedMs: number): string => {
  if (processedSoFar === 0) return "?";
  const rate = processedSoFar / (elapsedMs / 1000); // users/s
  const remaining = total - processedSoFar;
  const etaSec = remaining / rate;
  if (etaSec < 60) return `${Math.round(etaSec)}s`;
  if (etaSec < 3600) return `${Math.round(etaSec / 60)}m`;
  const h = Math.floor(etaSec / 3600);
  const m = Math.round((etaSec % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
};

// ─── Bulk SQL update (replaces N individual Prisma updates) ──────────────────

const bulkUpdateLanguages = async (results: BatchResult[]): Promise<void> => {
  if (results.length === 0) return;
  // pg doesn't serialize text[][] reliably via unnest — use a VALUES list instead
  const values = results.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::text[])`).join(", ");
  const params: (string | string[])[] = [];
  for (const r of results) { params.push(r.login, r.languages); }
  await pool.query(
    `UPDATE github_user u
     SET languages = v.langs, "languagesFetchedAt" = NOW()
     FROM (VALUES ${values}) AS v(ulogin, langs)
     WHERE u.login = v.ulogin`,
    params,
  );
};

// ─── --from-cache: pre-fill languages from star_event + badge_cache ───────────

const runFromCache = async (): Promise<void> => {
  console.log("\nPre-filling languages from star_event + badge_cache (no API calls)...");
  const minFollowersClause = MIN_FOLLOWERS > 0 ? `AND u.followers >= ${MIN_FOLLOWERS}` : "";
  const result = await pool.query<{ count: string }>(`
    WITH lang_counts AS (
      SELECT se.login, bc.language, COUNT(*)::int AS freq
      FROM star_event se
      JOIN badge_cache bc ON bc.owner = se.owner AND bc.repo = se.repo
      WHERE bc.language IS NOT NULL AND bc.language != ''
      GROUP BY se.login, bc.language
    ),
    ranked AS (
      SELECT login, array_agg(language ORDER BY freq DESC, language ASC) AS languages
      FROM lang_counts
      GROUP BY login
    ),
    updated AS (
      UPDATE github_user u
      SET languages = r.languages, "languagesFetchedAt" = NOW()
      FROM ranked r
      WHERE u.login = r.login
        AND u."languagesFetchedAt" IS NULL
        AND u.lat IS NOT NULL
        ${minFollowersClause}
      RETURNING u.login
    )
    SELECT COUNT(*)::text AS count FROM updated
  `);
  console.log(`  Pre-filled ${Number(result.rows[0].count).toLocaleString()} users from star_event + badge_cache`);
  console.log("  (These users now have languages derived from repos they starred — not commit history.)");
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const runStartTs = new Date().toISOString();

  console.log("\nBackfill tech languages from GitHub contributionsCollection");
  console.log(`  DB:            ${USE_PROD ? "Neon prod" : "local Docker"}`);
  console.log(`  Batch size:    ${BATCH_SIZE}`);
  console.log(`  Min followers: ${MIN_FOLLOWERS > 0 ? `≥${MIN_FOLLOWERS}` : "all"}`);
  console.log(`  Top users:     ${TOP_USERS > 0 ? TOP_USERS : "all"}`);
  console.log(`  Cursor:        ${START_CURSOR || "(none)"}`);
  console.log(`  Tokens:        ${FROM_CACHE ? "(none — cache mode)" : TOKEN_POOL.map((t) => t.token.slice(0, 8) + "…").join(", ")}`);
  const fetchMode = FORCE ? "all (--force)" : SINCE_DAYS > 0 ? `new + older than ${SINCE_DAYS}d (--since)` : "new only";
  console.log(`  Fetch mode:    ${fetchMode}`);
  console.log(`  From cache:    ${FROM_CACHE}`);
  console.log(`  Dry run:       ${DRY_RUN}`);
  console.log(`  Run start:     ${runStartTs}`);
  console.log(`\n  Rollback SQL (if needed):`);
  console.log(`  UPDATE github_user SET languages='{}', "languagesFetchedAt"=NULL WHERE "languagesFetchedAt">='${runStartTs}';\n`);

  // Fast path: derive languages from existing DB data — no GitHub API calls
  if (FROM_CACHE) {
    if (!DRY_RUN) await runFromCache();
    else console.log("  [dry-run] --from-cache skipped");
    await prisma.$disconnect();
    return;
  }

  // Build the languagesFetchedAt filter:
  //   --force          → no filter (re-fetch all)
  //   --since N        → null OR older than N days
  //   default          → null only (never fetched)
  const staleCutoff = SINCE_DAYS > 0
    ? new Date(Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000)
    : null;

  const fetchedAtFilter = FORCE
    ? {}
    : staleCutoff
      ? { OR: [{ languagesFetchedAt: null }, { languagesFetchedAt: { lt: staleCutoff } }] }
      : { languagesFetchedAt: null };

  const baseWhere = {
    lat: { not: null },   // only geocoded users — unmapped users won't appear on /devs anyway
    ...fetchedAtFilter,
    ...(MIN_FOLLOWERS > 0 ? { followers: { gte: MIN_FOLLOWERS } } : {}),
  };

  // Count targets
  const { _count: { login: total } } = await prisma.gitHubUser.aggregate({
    _count: { login: true },
    where: baseWhere,
  });

  console.log(`Users to process: ${total.toLocaleString()}`);
  if (total === 0) { console.log("Nothing to do."); await prisma.$disconnect(); return; }

  let processed   = 0;
  let withLangs   = 0;
  let cursor      = START_CURSOR || undefined;
  const startTime = Date.now();

  while (true) {
    const users = await prisma.gitHubUser.findMany({
      where: baseWhere,
      orderBy: [{ followers: "desc" }, { login: "asc" }],
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { login: cursor }, skip: 1 } : {}),
      select: { login: true },
    });

    if (users.length === 0) break;

    const logins = users.map((u) => u.login);

    try {
      const results = await fetchLanguagesBatch(logins);

      if (!DRY_RUN) {
        await bulkUpdateLanguages(results);
      }

      for (const r of results) {
        if (r.languages.length > 0) withLangs++;
        if (DRY_RUN && r.languages.length > 0) {
          console.log(`    ${r.login}: [${r.languages.slice(0, 5).join(", ")}]`);
        }
      }

      processed += logins.length;
      cursor = logins[logins.length - 1];

      if (processed % 200 === 0 || users.length < BATCH_SIZE) {
        const elapsed = Date.now() - startTime;
        const eta = formatEta(processed, total, elapsed);
        const tokenStatus = TOKEN_POOL.map((t) => `${t.token.slice(0, 8)}…:${t.remaining}`).join(" | ");
        console.log(
          `  ${processed.toLocaleString()}/${total.toLocaleString()} processed` +
          ` (${withLangs.toLocaleString()} with languages)` +
          ` — ${Math.round(elapsed / 1000)}s elapsed — ETA ${eta}` +
          ` — [${tokenStatus}]`,
        );
        console.log(`  Resume cursor: ${cursor}`);
      }
    } catch (err) {
      console.error(`  [error] batch at cursor=${cursor}:`, (err as Error).message);
      await sleep(5000);
      continue;
    }

    // Polite delay to stay under secondary rate limits
    await sleep(150);

    if (TOP_USERS > 0 && processed >= TOP_USERS) break;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone — ${processed.toLocaleString()} processed, ${withLangs.toLocaleString()} with languages in ${elapsed}s`);
  console.log("\nToken usage:");
  for (const t of TOKEN_POOL) {
    console.log(`  ${t.token.slice(0, 8)}…  ${t.callCount} calls, ${t.remaining} remaining`);
  }

  await prisma.$disconnect();
};

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
