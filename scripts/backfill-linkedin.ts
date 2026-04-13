// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * backfill-linkedin.ts
 *
 * Fetches LinkedIn URLs for github_user rows where linkedinUrl IS NULL.
 * Uses GitHub GraphQL API with batched aliased queries (20 users per request).
 * Supports multi-token rotation and resumability via --cursor <login>.
 *
 * Usage:
 *   pnpm backfill:linkedin [options]
 *
 * Options:
 *   --prod                Target Neon prod (default: local Docker)
 *   --min-followers <N>   Only process users with at least N followers (default: 0)
 *   --top <N>             Only process top N users by followers (default: all)
 *   --cursor <login>      Resume from this login (alphabetical order)
 *   --batch <N>           Users per GraphQL request (default: 20, max: 50)
 *   --dry-run             Query GitHub but don't write to DB
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

const { values: argv } = parseArgs({
  options: {
    "dry-run":       { type: "boolean", default: false },
    "prod":          { type: "boolean", default: false },
    "top":           { type: "string",  default: "0" },
    "min-followers": { type: "string",  default: "0" },
    "batch":         { type: "string",  default: "20" },
    "cursor":        { type: "string",  default: "" },
  },
  strict: true,
});

const DRY_RUN       = argv["dry-run"];
const USE_PROD      = argv.prod;
const TOP_USERS     = parseInt(argv.top,           10); // 0 = all
const MIN_FOLLOWERS = parseInt(argv["min-followers"], 10); // 0 = all
const BATCH_SIZE    = Math.min(parseInt(argv.batch, 10), 50);
const START_CURSOR  = argv.cursor;

const DB_URL = USE_PROD
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) { console.error("Error: no DB URL found"); process.exit(1); }

const pool   = new pg.Pool({ connectionString: DB_URL });
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
  return all.map((token) => ({ token, remaining: 5000, resetAt: 0, callCount: 0 }));
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

// ─── GitHub GraphQL — batch query (aliased users) ────────────────────────────

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

const fetchLinkedInBatch = async (
  logins: string[],
): Promise<Map<string, string | null>> => {
  const tok = await acquireToken();

  // Build aliased query: u0: user(login: "...") { ... }
  const aliases = logins
    .map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) {
      socialAccounts(first: 5) { nodes { provider url } }
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
    signal: AbortSignal.timeout(20_000),
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

  const json = await res.json() as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);

  const result = new Map<string, string | null>();
  for (let i = 0; i < logins.length; i++) {
    const userData = json.data?.[`u${i}`] as {
      socialAccounts?: { nodes: { provider: string; url: string }[] };
    } | null;
    const linkedinNode = (userData?.socialAccounts?.nodes ?? []).find(
      (n) => n.provider === "LINKEDIN",
    );
    result.set(logins[i], linkedinNode?.url?.startsWith("https://") ? linkedinNode.url : null);
  }
  return result;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const main = async () => {
  console.log("\nBackfill LinkedIn URLs from GitHub GraphQL");
  console.log(`  DB:         ${USE_PROD ? "Neon prod" : "local Docker"}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Min follow: ${MIN_FOLLOWERS > 0 ? `≥${MIN_FOLLOWERS}` : "all"}`);
  console.log(`  Top users:  ${TOP_USERS > 0 ? TOP_USERS : "all"}`);
  console.log(`  Cursor:     ${START_CURSOR || "(none)"}`);
  console.log(`  Tokens:     ${TOKEN_POOL.map((t) => t.token.slice(0, 8) + "…").join(", ")}`);
  console.log(`  Dry run:    ${DRY_RUN}`);
  console.log("");

  const baseWhere = {
    linkedinUrl: null,
    ...(MIN_FOLLOWERS > 0 ? { followers: { gte: MIN_FOLLOWERS } } : {}),
  };

  // Count targets
  const { _count: { login: total } } = await prisma.gitHubUser.aggregate({
    _count: { login: true },
    where: baseWhere,
  });
  console.log(`Users matching (null linkedinUrl${MIN_FOLLOWERS > 0 ? `, ≥${MIN_FOLLOWERS} followers` : ""}): ${total.toLocaleString()}`);
  if (total === 0) { console.log("Nothing to do."); await prisma.$disconnect(); return; }

  let processed = 0;
  let updated   = 0;
  let cursor    = START_CURSOR || undefined;
  const startTime = Date.now();

  while (true) {
    // Fetch next batch of users without LinkedIn
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
      const linkedinMap = await fetchLinkedInBatch(logins);

      if (!DRY_RUN) {
        // Bulk update — only users where we found a LinkedIn URL
        const toUpdate = [...linkedinMap.entries()].filter(([, url]) => url !== null);
        for (const [login, linkedinUrl] of toUpdate) {
          await prisma.gitHubUser.update({
            where: { login },
            data: { linkedinUrl },
          });
          updated++;
        }
      }

      processed += logins.length;
      cursor = logins[logins.length - 1];

      if (processed % 200 === 0 || users.length < BATCH_SIZE) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const tokenStatus = TOKEN_POOL.map((t) => `${t.token.slice(0, 8)}…:${t.remaining}`).join(" | ");
        console.log(`  ${processed.toLocaleString()} processed — ${updated.toLocaleString()} updated — ${elapsed}s — [${tokenStatus}]`);
        console.log(`  Resume cursor: ${cursor}`);
      }
    } catch (err) {
      console.error(`  [error] batch at cursor=${cursor}:`, (err as Error).message);
      // Short pause then retry
      await sleep(5000);
      continue;
    }

    // Polite delay between batches (avoid secondary rate limit)
    await sleep(500);

    if (TOP_USERS > 0 && processed >= TOP_USERS) break;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone — ${processed.toLocaleString()} users processed, ${updated.toLocaleString()} updated in ${elapsed}s`);
  console.log("\nToken usage:");
  for (const t of TOKEN_POOL) {
    console.log(`  ${t.token.slice(0, 8)}…  ${t.callCount} calls, ${t.remaining} remaining`);
  }

  await prisma.$disconnect();
};

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
