// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * batch-index-followers.ts
 *
 * Pre-warms the geocache for GitHub followers of all users in `github_user`.
 * Queries the DB for logins, then drives /api/followers-chunk for each one.
 *
 * Usage:
 *   make index-followers-all                         # ≥100 followers, prod API
 *   make index-followers-all-local LIMIT=5           # local, top 5 users only
 *   pnpm batch:index-followers -- --dry-run          # list users without indexing
 *   pnpm batch:index-followers -- --min-followers 0  # everyone (slow)
 *
 * Flags:
 *   --base-url <url>       API base URL (default: https://starmapper.bruniaux.com)
 *   --min-followers <n>    Min followers to include (default: 100)
 *   --limit <n>            Max users to process (for testing)
 *   --dry-run              Print target list without indexing
 *   --prod                 Use Neon prod DB (default: local Docker)
 *   --gh-token <token>     Force a single GitHub PAT (overrides pool)
 *   --timeout <ms>         Per-chunk timeout in ms (default: 30000)
 *
 * Multi-token: set GITHUB_TOKEN, GITHUB_TOKEN_2, GITHUB_TOKEN_3… in .env.local
 * for automatic rotation. On GitHub 429, the exhausted token is parked until its
 * resetAt and the next available token is used immediately.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    "base-url":       { type: "string",  default: "https://starmapper.bruniaux.com" },
    "min-followers":  { type: "string",  default: "100" },
    "limit":          { type: "string" },
    "dry-run":        { type: "boolean", default: false },
    "prod":           { type: "boolean", default: false },
    // --gh-token forces a single PAT; otherwise reads GITHUB_TOKEN, GITHUB_TOKEN_2, …
    "gh-token":       { type: "string" },
    "timeout":        { type: "string",  default: "30000" },
    // Delay between users (ms). Default 2200 = ~27 req/min, under the 30/min IP limit.
    "inter-delay":    { type: "string",  default: "2200" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const baseUrl       = (values["base-url"] as string).replace(/\/$/, "");
const minFollowers  = parseInt(values["min-followers"] as string, 10);
const limit         = values["limit"] ? parseInt(values["limit"] as string, 10) : undefined;
const dryRun        = values["dry-run"] as boolean;
const useProd       = values["prod"] as boolean;
const ghTokenOverride = values["gh-token"] as string | undefined;
const timeoutMs       = parseInt(values["timeout"] as string, 10);
const interDelayMs    = parseInt(values["inter-delay"] as string, 10);

const DB_URL = useProd
  ? (process.env.DATABASE_URL ?? "")
  : (process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "");

if (!DB_URL) {
  console.error("Error: no DB URL found (DATABASE_URL_LOCAL or DATABASE_URL)");
  process.exit(1);
}

// ─── Prisma ───────────────────────────────────────────────────────────────────

const pool   = new pg.Pool({ connectionString: DB_URL, options: "-c statement_timeout=0" });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Multi-token pool ─────────────────────────────────────────────────────────

type TokenState = {
  token: string;
  exhaustedUntil: number; // Date.now() ms; 0 = available
};

const buildTokenPool = (): TokenState[] => {
  // --gh-token overrides: use that single token only.
  if (ghTokenOverride) return [{ token: ghTokenOverride, exhaustedUntil: 0 }];

  const tokens: string[] = [];
  if (process.env.GITHUB_TOKEN) tokens.push(process.env.GITHUB_TOKEN);
  let i = 2;
  while (true) {
    const t = process.env[`GITHUB_TOKEN_${i}`];
    if (!t) break;
    tokens.push(t);
    i++;
  }
  return tokens.map((token) => ({ token, exhaustedUntil: 0 }));
};

const TOKEN_POOL = buildTokenPool();

/** Returns the first non-exhausted token, or null if all are still cooling down. */
const getAvailableToken = (): TokenState | null => {
  const now = Date.now();
  return TOKEN_POOL.find((t) => t.exhaustedUntil <= now) ?? null;
};

/**
 * Returns an available token. If all tokens are exhausted, waits for the
 * earliest one to recover and returns it.
 */
const acquireToken = async (): Promise<TokenState | null> => {
  if (TOKEN_POOL.length === 0) return null;
  const available = getAvailableToken();
  if (available) return available;

  const earliest = TOKEN_POOL.reduce((min, t) => (t.exhaustedUntil < min.exhaustedUntil ? t : min));
  const waitMs   = Math.max(0, earliest.exhaustedUntil - Date.now()) + 2_000;
  const waitSec  = Math.ceil(waitMs / 1000);
  process.stdout.write(`\n    [token-pool] All ${TOKEN_POOL.length} tokens exhausted — waiting ${waitSec}s\n`);
  await new Promise((r) => setTimeout(r, waitMs));
  earliest.exhaustedUntil = 0;
  return earliest;
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const COOKIE_NAME   = "sm-token";
const REFRESH_EVERY = 200;

const fetchSmToken = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${baseUrl}/`, {
      headers: { "User-Agent": "StarMapper-indexer/1.0 (script; starmapper.bruniaux.com)", Accept: "text/html" },
      redirect: "follow",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const fmtCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

// ─── Per-login chunk loop ─────────────────────────────────────────────────────

type ChunkResult = { mapped: number; unmapped: number; chunks: number; ok: boolean };

const indexLoginFollowers = async (
  login: string,
  baseHeaders: Record<string, string>,
  tokenRef: { value: string | null; chunkCount: number },
): Promise<ChunkResult> => {
  let cursor: string | null = null;
  let mapped    = 0;
  let unmapped  = 0;
  let chunkNum  = 0;
  let total     = 0;
  let ipRetries = 0;

  while (true) {
    chunkNum++;
    tokenRef.chunkCount++;

    // Refresh HMAC token periodically to stay within 2h TTL.
    if (tokenRef.chunkCount % REFRESH_EVERY === 0 && tokenRef.value) {
      const fresh = await fetchSmToken();
      if (fresh) {
        tokenRef.value = fresh;
        baseHeaders["Cookie"] = `${COOKIE_NAME}=${fresh}`;
      }
    }

    // Pick the best available GitHub token for this chunk.
    const ghTok = await acquireToken();
    if (ghTok) {
      baseHeaders["x-gh-token"] = ghTok.token;
    } else {
      delete baseHeaders["x-gh-token"];
    }

    const body: Record<string, string> = { login };
    if (cursor) body.cursor = cursor;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/followers-chunk`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    Chunk ${chunkNum} failed: ${msg}`);
      return { mapped, unmapped, chunks: chunkNum, ok: false };
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 429) {
      const data = (await resp.json().catch(() => ({}))) as { resetAt?: number };
      if (data.resetAt) {
        // GitHub quota exhausted for this token — park it and rotate immediately.
        if (ghTok) {
          ghTok.exhaustedUntil = data.resetAt + 2_000;
          const poolDesc = TOKEN_POOL.length > 1 ? ` (rotating, ${TOKEN_POOL.filter((t) => t.exhaustedUntil <= Date.now()).length} token(s) left)` : "";
          process.stdout.write(`\n    GitHub rate limited${poolDesc} — token parked until ${new Date(data.resetAt).toLocaleTimeString()}\n`);
        } else {
          const waitMs  = Math.max(10_000, data.resetAt - Date.now());
          const waitSec = Math.ceil(waitMs / 1000);
          process.stdout.write(`\n    GitHub rate limited (no token). Waiting ${waitSec}s...\n`);
          await new Promise((r) => setTimeout(r, waitMs));
        }
        chunkNum--;
        tokenRef.chunkCount--;
        continue;
      }
      // IP rate limit (sliding window) — back off and retry up to 3 times.
      if (ipRetries < 3) {
        ipRetries++;
        process.stdout.write(`\n    IP rate limited (${ipRetries}/3). Waiting 5s...\n`);
        await new Promise((r) => setTimeout(r, 5_000));
        chunkNum--;
        tokenRef.chunkCount--;
        continue;
      }
      console.error(`    Chunk ${chunkNum} HTTP 429 — too many retries`);
      return { mapped, unmapped, chunks: chunkNum, ok: false };
    }
    ipRetries = 0;

    if (!resp.ok) {
      console.error(`    Chunk ${chunkNum} HTTP ${resp.status}`);
      return { mapped, unmapped, chunks: chunkNum, ok: false };
    }

    const data = (await resp.json()) as {
      points?: unknown[];
      unmapped?: unknown[];
      nextCursor?: string | null;
      totalCount?: number;
      error?: string;
    };

    if (data.error) {
      console.error(`    Chunk ${chunkNum} error: ${data.error}`);
      return { mapped, unmapped, chunks: chunkNum, ok: false };
    }

    const pts = data.points?.length ?? 0;
    const unm = data.unmapped?.length ?? 0;
    cursor   = data.nextCursor ?? null;
    total    = data.totalCount ?? total;
    mapped   += pts;
    unmapped += unm;

    process.stdout.write(
      `    Chunk ${String(chunkNum).padEnd(4)} | +${String(pts).padEnd(3)} mapped | +${String(unm).padEnd(3)} unmapped | ${mapped + unmapped}/${total}\n`,
    );

    if (!cursor) break;
  }

  return { mapped, unmapped, chunks: chunkNum, ok: true };
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const startMs = Date.now();

  // Fetch target list from DB.
  const users = await prisma.gitHubUser.findMany({
    where:   { followers: { gte: minFollowers } },
    select:  { login: true, followers: true },
    orderBy: { followers: "desc" },
    ...(limit !== undefined ? { take: limit } : {}),
  });

  await prisma.$disconnect();
  await pool.end();

  const filterDesc = minFollowers > 0 ? ` with followers >= ${minFollowers}` : "";
  console.log(`Found ${users.length} users${filterDesc} (ordered by followers desc)`);

  if (dryRun) {
    console.log("\nDry run — would index:\n");
    users.forEach((u, i) => {
      console.log(`  ${String(i + 1).padStart(4)}. @${u.login} (${fmtCount(u.followers)} followers)`);
    });
    console.log(`\nRun without --dry-run to start indexing.`);
    return;
  }

  console.log(`Target: ${baseUrl}`);
  if (TOKEN_POOL.length > 0) {
    console.log(`GitHub tokens: ${TOKEN_POOL.length} (rotation ${TOKEN_POOL.length > 1 ? "enabled" : "disabled"})`);
  } else {
    console.log("No GitHub token — using shared server quota.");
  }
  console.log();

  // Bootstrap session token.
  process.stdout.write("Bootstrapping session token... ");
  const smToken = await fetchSmToken();
  console.log(smToken ? "ok" : "not available (local dev is fine)");

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "StarMapper-indexer/1.0 (script; starmapper.bruniaux.com)",
  };
  if (smToken) baseHeaders["Cookie"] = `${COOKIE_NAME}=${smToken}`;
  // x-gh-token is set per-chunk inside indexLoginFollowers via acquireToken()

  const tokenRef = { value: smToken, chunkCount: 0 };

  // Iterate over all users.
  let totalMapped   = 0;
  let totalUnmapped = 0;
  let totalErrors   = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (!u) continue;
    console.log(`\n[${i + 1}/${users.length}] @${u.login} (${fmtCount(u.followers)} followers)`);

    if (i > 0 && interDelayMs > 0) {
      await new Promise((r) => setTimeout(r, interDelayMs));
    }

    const result = await indexLoginFollowers(u.login, baseHeaders, tokenRef);

    const pct = result.mapped + result.unmapped > 0
      ? Math.round((result.mapped * 100) / (result.mapped + result.unmapped))
      : 0;

    console.log(
      `  Done: ${result.mapped} mapped (${pct}%), ${result.unmapped} unmapped` +
      (result.ok ? "" : " [ERROR]"),
    );

    totalMapped   += result.mapped;
    totalUnmapped += result.unmapped;
    if (!result.ok) totalErrors++;
  }

  const durationMs  = Date.now() - startMs;
  const durationMin = Math.round(durationMs / 60_000);
  const totalPct    = totalMapped + totalUnmapped > 0
    ? Math.round((totalMapped * 100) / (totalMapped + totalUnmapped))
    : 0;

  console.log(`\nSummary`);
  console.log(`  Users indexed   : ${users.length - totalErrors}/${users.length}`);
  console.log(`  Total mapped    : ${totalMapped} (${totalPct}%)`);
  console.log(`  Total unmapped  : ${totalUnmapped}`);
  console.log(`  Errors          : ${totalErrors}`);
  console.log(`  Duration        : ${durationMin}min`);
  console.log(`  DB              : ${useProd ? "Neon prod" : "local Docker"}`);
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
