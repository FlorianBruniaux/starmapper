// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * batch-index-followers.ts
 *
 * Pre-warms the geocache for GitHub followers of all users in `github_user`.
 * Calls fetchFollowersPage + geocodeBatch directly — no HTTP server needed.
 *
 * Usage:
 *   make index-followers-all                         # ≥100 followers, prod DB
 *   make index-followers-all-local LIMIT=5           # local Docker DB, top 5
 *   pnpm batch:index-followers -- --dry-run          # list users without indexing
 *   pnpm batch:index-followers -- --min-followers 0  # everyone (slow)
 *
 * Flags:
 *   --min-followers <n>    Min followers to include (default: 100)
 *   --limit <n>            Max users to process (for testing)
 *   --dry-run              Print target list without indexing
 *   --prod                 Use Neon prod DB (default: local Docker)
 *   --gh-token <token>     Force a single GitHub PAT (overrides pool)
 *
 * Multi-token: set GITHUB_TOKEN, GITHUB_TOKEN_2, GITHUB_TOKEN_3… in .env.local
 * for automatic rotation. On GitHub 429, the exhausted token is parked until
 * its resetAt and the next available token is used immediately.
 */

import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { fetchFollowersPage, GitHubRateLimitError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    "min-followers": { type: "string",  default: "100" },
    "limit":         { type: "string" },
    "dry-run":       { type: "boolean", default: false },
    "prod":          { type: "boolean", default: false },
    // --gh-token forces a single PAT; otherwise reads GITHUB_TOKEN, GITHUB_TOKEN_2, …
    "gh-token":      { type: "string" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const minFollowers    = parseInt(values["min-followers"] as string, 10);
const limit           = values["limit"] ? parseInt(values["limit"] as string, 10) : undefined;
const dryRun          = values["dry-run"] as boolean;
const useProd         = values["prod"] as boolean;
const ghTokenOverride = values["gh-token"] as string | undefined;

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

const getAvailableToken = (): TokenState | null => {
  const now = Date.now();
  return TOKEN_POOL.find((t) => t.exhaustedUntil <= now) ?? null;
};

const acquireToken = async (): Promise<TokenState | null> => {
  if (TOKEN_POOL.length === 0) return null;
  const available = getAvailableToken();
  if (available) return available;

  const earliest = TOKEN_POOL.reduce((min, t) => (t.exhaustedUntil < min.exhaustedUntil ? t : min));
  const waitMs   = Math.max(0, earliest.exhaustedUntil - Date.now()) + 2_000;
  const waitMin  = Math.ceil(waitMs / 60_000);
  process.stdout.write(`\n  [token-pool] All ${TOKEN_POOL.length} tokens exhausted — waiting ${waitMin}min\n`);
  await new Promise((r) => setTimeout(r, waitMs));
  earliest.exhaustedUntil = 0;
  return earliest;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Per-login chunk loop ─────────────────────────────────────────────────────

type ChunkResult = { mapped: number; unmapped: number; chunks: number; ok: boolean };

const indexLoginFollowers = async (login: string): Promise<ChunkResult> => {
  let cursor: string | null = null;
  let mapped   = 0;
  let unmapped = 0;
  let chunkNum = 0;
  let total    = 0;

  while (true) {
    chunkNum++;

    const tok = await acquireToken();
    const token = tok?.token;

    let page: Awaited<ReturnType<typeof fetchFollowersPage>>;
    try {
      page = await fetchFollowersPage(login, cursor, token);
    } catch (err) {
      if (err instanceof GitHubRateLimitError) {
        if (tok) {
          tok.exhaustedUntil = err.resetAt + 2_000;
          const available = TOKEN_POOL.filter((t) => t.exhaustedUntil <= Date.now()).length;
          process.stdout.write(
            `\n    GitHub rate limited — token parked (${available}/${TOKEN_POOL.length} available)\n`,
          );
        }
        chunkNum--;
        continue;
      }
      console.error(`    Chunk ${chunkNum} error: ${err instanceof Error ? err.message : String(err)}`);
      return { mapped, unmapped, chunks: chunkNum, ok: false };
    }

    total = page.totalCount;

    // Only geocode locations not already fresh in the DB.
    const logins = page.followers.map((f) => f.login);
    const knownUsers = await bulkReadUsers(logins);

    const locationsToGeocode = page.followers
      .filter((f) => {
        const known = knownUsers.get(f.login);
        if (!known) return true;
        const isStale = Date.now() - known.fetchedAt.getTime() > STALE_MS;
        const locationChanged = known.location !== (f.location ?? null);
        return isStale || locationChanged;
      })
      .map((f) => f.location ?? "")
      .filter(Boolean);

    const geoMap = await geocodeBatch(locationsToGeocode);

    let pts = 0;
    let unm = 0;
    for (const f of page.followers) {
      const known = knownUsers.get(f.login);
      const loc   = f.location ?? "";
      let coords: [number, number] | null = null;

      if (known?.lat != null && known.lng != null && known.location === loc) {
        coords = [known.lat, known.lng];
      } else if (loc) {
        coords = geoMap.get(loc) ?? null;
      }

      if (coords) { pts++; } else { unm++; }
    }

    mapped   += pts;
    unmapped += unm;
    cursor    = page.nextCursor;

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
    console.log("\nRun without --dry-run to start indexing.");
    return;
  }

  if (TOKEN_POOL.length > 0) {
    console.log(`GitHub tokens: ${TOKEN_POOL.length} (rotation ${TOKEN_POOL.length > 1 ? "enabled" : "disabled"})`);
  } else {
    console.log("No GitHub token — rate limited to 60 req/hr.");
  }
  console.log(`DB: ${useProd ? "Neon prod" : "local Docker"}\n`);

  let totalMapped   = 0;
  let totalUnmapped = 0;
  let totalErrors   = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (!u) continue;
    console.log(`\n[${i + 1}/${users.length}] @${u.login} (${fmtCount(u.followers)} followers)`);

    const result = await indexLoginFollowers(u.login);

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

  console.log("\nSummary");
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
