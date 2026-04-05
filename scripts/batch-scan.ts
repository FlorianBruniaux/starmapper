// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * batch-scan.ts
 *
 * Scans a list of GitHub repos and writes results to a local Postgres DB.
 * Designed to run against Docker Postgres locally (fast, free, no Neon costs).
 * After scanning, sync to Neon with: ./scripts/db-sync-to-neon.sh
 *
 * Usage:
 *   pnpm batch:scan:local --input scripts/repos-all.json [--dry-run] [--force] [--skip-geocoding]
 *
 * Flags:
 *   --input <path>       JSON array of "owner/repo" strings (required)
 *   --local              Use DATABASE_URL_LOCAL from .env.local (Docker Postgres)
 *   --dry-run            Preview only — no DB writes, shows geocoding budget estimate
 *   --force              Full rescan (ignores existing cache, deletes stale star_events)
 *   --allow-neon         Explicitly allow writing to Neon production DB
 *   --skip-geocoding     Fetch GitHub data only, skip geocoding
 *   --token <PAT>        GitHub PAT override (otherwise uses GITHUB_TOKEN from env)
 *   --flush-every <N>    Flush github_user + star_event every N users (default: 2000)
 *
 * Delta scanning (default behavior):
 *   If a repo is cached with latestStarredAt → only fetches new stars since that date,
 *   then merges with existing cached data. Use --force to bypass and do a full rescan.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { gzipSync, gunzipSync } from "zlib";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ─── Load .env.local BEFORE anything reads env vars ──────────────────────────

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
  } catch {
    // .env.local not present — rely on environment
  }
};

loadEnvLocal();

// ─── Global error handlers ────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  console.error("\n[FATAL] uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("\n[FATAL] unhandledRejection:", reason);
  process.exit(1);
});

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN        = argv.includes("--dry-run");
const FORCE          = argv.includes("--force");
const SKIP_GEOCODING = argv.includes("--skip-geocoding");
// --local  Use DATABASE_URL_LOCAL from .env.local (Docker Postgres).
const USE_LOCAL      = argv.includes("--local");
// --allow-neon  Explicitly allow writing to Neon production. Separate from --force
// (which means "rescan even if cached") to prevent accidental Neon writes.
const ALLOW_NEON     = argv.includes("--allow-neon");

const get = (flag: string) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] ?? null : null;
};

const INPUT_FILE     = get("--input");
const TOKEN_OVERRIDE = get("--token");
// --flush-every <N>  Flush github_user + star_event to DB every N users (default: 2000).
//                    Prevents losing hours of work if the process is interrupted.
const FLUSH_EVERY_RAW = parseInt(get("--flush-every") ?? "2000", 10);
if (isNaN(FLUSH_EVERY_RAW) || FLUSH_EVERY_RAW < 1) {
  console.error("Error: --flush-every must be a positive integer (got: " + get("--flush-every") + ")");
  process.exit(1);
}
const FLUSH_EVERY = FLUSH_EVERY_RAW;

if (!INPUT_FILE) {
  console.error("Error: --input <repos.json> is required");
  console.error("  Example: pnpm batch:scan:local --input scripts/repos-all.json");
  process.exit(1);
}

// ─── Env validation ──────────────────────────────────────────────────────────

const DATABASE_URL = (USE_LOCAL ? process.env.DATABASE_URL_LOCAL : null) ?? process.env.DATABASE_URL ?? "";
const GITHUB_TOKEN = TOKEN_OVERRIDE ?? process.env.GITHUB_TOKEN ?? "";

if (!DATABASE_URL) {
  if (USE_LOCAL) {
    console.error("Error: DATABASE_URL_LOCAL is not set in .env.local.");
    console.error("  Add: DATABASE_URL_LOCAL=postgresql://starmapper:starmapper@localhost:5433/starmapper");
  } else {
    console.error("Error: DATABASE_URL is not set.");
    console.error("  Tip: use --local to target Docker Postgres via DATABASE_URL_LOCAL in .env.local");
  }
  process.exit(1);
}

// Neon production guard — --force only means "rescan if already cached", not "write to Neon".
// Use --allow-neon explicitly if you really want to target Neon.
if (DATABASE_URL.includes("neon.tech") && !ALLOW_NEON && !USE_LOCAL) {
  console.error("Warning: DATABASE_URL points to Neon production.");
  console.error("  Run against a local Docker Postgres to avoid Neon costs.");
  console.error("  Use --local (reads DATABASE_URL_LOCAL from .env.local) or --allow-neon to explicitly target Neon.");
  process.exit(1);
}

if (!GITHUB_TOKEN) {
  console.warn("Warning: GITHUB_TOKEN not set — limited to 60 req/hr (unauthenticated).");
}

// ─── Prisma (standard TCP via pg adapter — works with local Docker Postgres) ──

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Graceful shutdown on SIGINT / SIGTERM ────────────────────────────────────

const gracefulShutdown = async (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGINT",  () => { void gracefulShutdown("SIGINT");  });
process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });

// ─── Input ───────────────────────────────────────────────────────────────────

const reposRaw = JSON.parse(readFileSync(INPUT_FILE, "utf8")) as string[];
const repos = reposRaw.map((r) => {
  const parts = r.replace(/^https?:\/\/github\.com\//, "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid repo format: "${r}"`);
  return { owner: parts[0], repo: parts[1] };
});

// ─── Country extraction (inline to keep script isolated) ─────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "u.s.": "United States",
  "u.s.a.": "United States", america: "United States",
  uk: "United Kingdom", england: "United Kingdom", "great britain": "United Kingdom",
  scotland: "United Kingdom", wales: "United Kingdom",
  uae: "United Arab Emirates", drc: "Democratic Republic of the Congo",
  nz: "New Zealand", holland: "Netherlands", "the netherlands": "Netherlands",
  rok: "South Korea", dprk: "North Korea", "russian federation": "Russia",
  "viet nam": "Vietnam", brasil: "Brazil", "hong kong": "Hong Kong",
  taiwan: "Taiwan", "republic of china": "Taiwan", türkiye: "Turkey",
  "czech republic": "Czechia",
};

// Deduplicated set — was previously duplicated across two blocks
const COUNTRY_INDICATORS = new Set([
  "afghanistan", "albania", "algeria", "argentina", "armenia", "australia", "austria", "azerbaijan",
  "bangladesh", "belarus", "belgium", "brazil", "bulgaria",
  "canada", "chile", "china", "colombia", "croatia", "cyprus", "czechia",
  "denmark", "egypt", "estonia", "ethiopia",
  "finland", "france",
  "georgia", "germany", "ghana", "greece",
  "hong kong", "hungary",
  "iceland", "india", "indonesia", "iran", "iraq", "ireland", "israel", "italy",
  "japan", "jordan",
  "kenya",
  "latvia", "lithuania", "luxembourg",
  "malaysia", "malta", "mexico", "moldova", "morocco",
  "netherlands", "new zealand", "nigeria", "north korea", "norway",
  "pakistan", "peru", "philippines", "poland", "portugal",
  "romania", "russia",
  "saudi arabia", "serbia", "singapore", "slovakia", "south africa", "south korea", "spain", "sweden", "switzerland",
  "taiwan", "thailand", "turkey",
  "ukraine", "united arab emirates", "united kingdom", "united states",
  "vietnam",
]);

const extractCountry = (location: string | null): string | null => {
  if (!location) return null;
  const parts = location.split(",").map((p) => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const lower = parts[i].toLowerCase();
    if (COUNTRY_ALIASES[lower]) return COUNTRY_ALIASES[lower];
    if (COUNTRY_INDICATORS.has(lower)) {
      return parts[i].replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
};

// ─── Sleep ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── GitHub GraphQL ───────────────────────────────────────────────────────────

const GH_GRAPHQL = "https://api.github.com/graphql";
const MAX_FETCH_ATTEMPTS = 8;

type StargazerRaw = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  linkedinUrl: string | null;
  starredAt: string;
};

type GHPage = {
  stargazers: StargazerRaw[];
  nextCursor: string | null;
  totalCount: number;
  rateRemaining: number;
  rateReset: number;
};

const GRAPHQL_QUERY = `
  query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      stargazerCount
      stargazers(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        edges {
          starredAt
          node {
            login name company location
            followers { totalCount }
            socialAccounts(first: 5) { nodes { provider url } }
          }
        }
      }
    }
  }
`;

// Iterative retry loop — no recursion, bounded by MAX_FETCH_ATTEMPTS.
const fetchPage = async (
  owner: string,
  repo: string,
  cursor: string | null,
  since?: string, // ISO timestamp — stop when we hit stars older or equal to this
): Promise<GHPage> => {
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(GH_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "starmapper-batch/1.0",
          ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          query: GRAPHQL_QUERY,
          variables: { owner, repo, ...(cursor ? { cursor } : {}) },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= MAX_FETCH_ATTEMPTS - 1) {
        throw new Error(`Network error after ${MAX_FETCH_ATTEMPTS} attempts: ${(err as Error).message}`);
      }
      const waitSec = Math.min(30 * 2 ** attempt, 300);
      console.warn(`    [network] fetch error (attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS}): ${(err as Error).message} — retry in ${waitSec}s`);
      await sleep(waitSec * 1000);
      continue;
    }

    const rateRemaining = Number(res.headers.get("x-ratelimit-remaining") ?? 5000);
    const rateReset     = Number(res.headers.get("x-ratelimit-reset")     ?? 0);

    if (res.status === 403 || res.status === 429) {
      if (attempt >= MAX_FETCH_ATTEMPTS - 1) {
        throw new Error(`Rate-limited after ${MAX_FETCH_ATTEMPTS} attempts`);
      }
      const waitMs =
        rateReset > 0
          ? Math.max(0, rateReset * 1000 - Date.now()) + 5_000
          : Math.min(60_000 * 2 ** attempt, 15 * 60 * 1000);
      const waitSec = Math.round(waitMs / 1000);
      console.warn(`    [rate-limit] ${res.status} — pausing ${waitSec}s (attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS})...`);
      await sleep(waitMs);
      continue;
    }

    if (res.status === 404) {
      throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
    }

    if (!res.ok) {
      if (attempt >= MAX_FETCH_ATTEMPTS - 1) {
        throw new Error(`GitHub HTTP ${res.status} after ${MAX_FETCH_ATTEMPTS} attempts`);
      }
      console.warn(`    [http] status ${res.status} — retry ${attempt + 1}/${MAX_FETCH_ATTEMPTS}`);
      await sleep(5000 * (attempt + 1));
      continue;
    }

    const json = await res.json() as { errors?: { message?: string }[]; data?: { repository?: unknown } };
    if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "GraphQL error");

    const data = json.data?.repository as {
      stargazerCount: number;
      stargazers: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        edges: {
          starredAt: string;
          node: {
            login: string;
            name: string | null;
            company: string | null;
            location: string | null;
            followers: { totalCount: number };
            socialAccounts?: { nodes: { provider: string; url: string }[] };
          };
        }[];
      };
    } | null | undefined;

    if (!data) throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });

    const page = data.stargazers;
    const sinceTs = since ? new Date(since).getTime() : null;
    let hasMore = page.pageInfo.hasNextPage;
    const stargazers: StargazerRaw[] = [];

    for (const e of page.edges) {
      if (sinceTs !== null && new Date(e.starredAt).getTime() <= sinceTs) {
        hasMore = false; // hit stars already in cache — stop
        break;
      }
      const linkedinNode = (e.node.socialAccounts?.nodes ?? []).find(
        (n) => n.provider === "LINKEDIN",
      );
      stargazers.push({
        login:      e.node.login,
        name:       e.node.name ?? null,
        company:    e.node.company ? e.node.company.trim().replace(/^@/, "") : null,
        location:   e.node.location ?? null,
        followers:  e.node.followers.totalCount,
        linkedinUrl: linkedinNode?.url?.startsWith("https://") ? linkedinNode.url : null,
        starredAt:  e.starredAt,
      });
    }

    return {
      totalCount:    data.stargazerCount,
      nextCursor:    hasMore ? page.pageInfo.endCursor : null,
      stargazers,
      rateRemaining,
      rateReset,
    };
  }

  throw new Error(`fetchPage: exhausted ${MAX_FETCH_ATTEMPTS} attempts`);
};

// ─── Geocoding cascade ────────────────────────────────────────────────────────

const JAWG_URL       = "https://api.jawg.io/places/v1/search";
const GEOAPIFY_URL   = "https://api.geoapify.com/v1/geocode/search";
const NOMINATIM_URL  = "https://nominatim.openstreetmap.org/search";

// Patterns that are not geocodeable locations.
// Note: alternatives with `.*` are not anchored — they match anywhere in the string.
const NOT_GEOCODEABLE_ANCHOR = /^(remote|earth|internet|worldwide|global|anywhere|virtual|online|distributed|nomad|moon|space|mars)$/i;
const NOT_GEOCODEABLE_ANYWHERE = /[@]|[.](com|io|org|net|dev)\b|^[\d\s+().\-]{5,}$/i;

const isGeocodeable = (loc: string) => {
  const t = loc.trim();
  return t.length >= 2 && !NOT_GEOCODEABLE_ANCHOR.test(t) && !NOT_GEOCODEABLE_ANYWHERE.test(t);
};

type Coords = [number, number]; // [lat, lng]

const jawgGeocode = async (loc: string): Promise<Coords | null> => {
  const token = process.env.JAWGMAP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const url = `${JAWG_URL}?text=${encodeURIComponent(loc)}&size=1&access-token=${token}`;
    const r = await fetch(url, { headers: { "User-Agent": "starmapper-batch/1.0" }, signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return null;
    const f = (await r.json() as { features?: { geometry: { coordinates: [number, number] } }[] }).features?.[0];
    if (!f) return null;
    const [lng, lat] = f.geometry.coordinates;
    return [lat, lng];
  } catch {
    return null;
  }
};

const geoapifyGeocode = async (loc: string): Promise<Coords | null> => {
  const key = process.env.GEOAPIFY_APIKEY;
  if (!key) return null;
  try {
    const url = `${GEOAPIFY_URL}?text=${encodeURIComponent(loc)}&limit=1&format=json&apiKey=${key}`;
    const r = await fetch(url, { headers: { "User-Agent": "starmapper-batch/1.0" }, signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return null;
    const row = (await r.json() as { results?: { lat: number; lon: number }[] }).results?.[0];
    if (!row) return null;
    return [row.lat, row.lon];
  } catch {
    return null;
  }
};

let lastNominatim = 0;

const nominatimGeocode = async (loc: string): Promise<Coords | null> => {
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await sleep(wait);
  lastNominatim = Date.now();
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(loc)}&limit=1&format=json`;
    const r = await fetch(url, {
      headers: { "User-Agent": "starmapper-batch/1.0 (https://starmapper.bruniaux.com)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const row = (await r.json() as { lat?: string; lon?: string }[])[0];
    if (!row) return null;
    return [parseFloat(row.lat!), parseFloat(row.lon!)];
  } catch {
    return null;
  }
};

// Session-level in-memory cache — avoids re-querying DB for the same location key across pages.
// Across a 1000-page scan, ~90% of location lookups are cache hits after the first few pages.
const geoSessionCache = new Map<string, Coords | null>();

const geocodeBulk = async (
  locations: string[],
): Promise<Map<string, Coords | null>> => {
  const result = new Map<string, Coords | null>();
  const todo = locations.filter(isGeocodeable).map((l) => l.toLowerCase().trim());
  const unique = [...new Set(todo)];

  if (unique.length === 0) return result;

  // 1. Session cache (zero DB round-trip)
  const sessionMisses = unique.filter((k) => {
    if (geoSessionCache.has(k)) {
      result.set(k, geoSessionCache.get(k)!);
      return false;
    }
    return true;
  });

  // 2. Bulk DB geocache read for session misses
  if (sessionMisses.length > 0) {
    try {
      const rows = await prisma.geoCache.findMany({ where: { key: { in: sessionMisses } } });
      for (const row of rows) {
        const coords: Coords | null = row.lat !== null && row.lng !== null ? [row.lat, row.lng] : null;
        result.set(row.key, coords);
        geoSessionCache.set(row.key, coords);
      }
    } catch {
      // Cache unavailable — proceed to API calls
    }
  }

  if (SKIP_GEOCODING) return result;

  const misses = unique.filter((k) => !result.has(k));

  // 3. Cascade for misses: Jawg → Geoapify → Nominatim
  for (const key of misses) {
    let coords: Coords | null = await jawgGeocode(key);
    if (!coords) coords = await geoapifyGeocode(key);
    if (!coords) coords = await nominatimGeocode(key);

    result.set(key, coords);
    geoSessionCache.set(key, coords);

    if (!DRY_RUN) {
      try {
        await prisma.geoCache.upsert({
          where: { key },
          create: { key, lat: coords?.[0] ?? null, lng: coords?.[1] ?? null },
          update: { lat: coords?.[0] ?? null, lng: coords?.[1] ?? null },
        });
      } catch {
        // Non-critical — geocache write failure is fine
      }
    }
  }

  return result;
};

// ─── DB writes ────────────────────────────────────────────────────────────────

const concurrentMap = async <T, R>(items: T[], fn: (x: T) => Promise<R>, limit = 20) => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return results;
};

type SlimPoint = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  lat: number;
  lng: number;
  linkedinUrl: string | null;
  starredAt: string | null;
};

// Error handler for Prisma upserts: ignores unique constraint violations (P2002, expected in
// concurrent upserts on re-runs), logs everything else so data loss is visible.
const onUpsertError = (context: string) => (err: unknown): null => {
  const code = (err as { code?: string }).code;
  if (code !== "P2002") {
    console.warn(`  [db-warn] ${context}: ${(err as Error).message ?? String(err)} (code: ${code ?? "?"})`);
  }
  return null;
};

type UnmappedUser = { login: string; name: string | null; location: string | null; followers: number; starredAt: string | null };

const writeRepoCache = async (
  owner: string,
  repo: string,
  points: SlimPoint[],
  unmapped: UnmappedUser[],
  totalCount: number,
  latestStarredAt?: Date,
) => {
  const pointsGz   = gzipSync(JSON.stringify(points)).toString("base64");
  const unmappedGz = gzipSync(JSON.stringify(unmapped)).toString("base64");
  const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
  const now = new Date();

  const countries = new Set<string>();
  for (const p of points) {
    const c = extractCountry(p.location);
    if (c) countries.add(c);
  }

  await prisma.stargazerCache.upsert({
    where: { owner_repo: key },
    create: { ...key, points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: now, latestStarredAt: latestStarredAt ?? null },
    update: { points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: now, ...(latestStarredAt ? { latestStarredAt } : {}) },
  });

  await prisma.badgeCache.upsert({
    where: { owner_repo: key },
    create: { ...key, mappedCount: points.length, countryCount: countries.size, totalCount, updatedAt: now },
    update: { mappedCount: points.length, countryCount: countries.size, totalCount, updatedAt: now },
  });
};

const writeUsers = async (
  owner: string,
  repo: string,
  points: SlimPoint[],
  unmapped: UnmappedUser[],
) => {
  // Deduplicate by login — GitHub pagination edge cases can return the same user on two adjacent
  // pages. Duplicates in the same concurrentMap batch race on INSERT and one fails P2002
  // (silently swallowed), leaving the user absent from github_user and breaking the FK.
  const seenLogins = new Set<string>();
  const uniquePoints = points.filter((p) => {
    if (seenLogins.has(p.login)) return false;
    seenLogins.add(p.login);
    return true;
  });
  const uniqueUnmapped = unmapped.filter((u) => {
    if (seenLogins.has(u.login)) return false;
    seenLogins.add(u.login);
    return true;
  });

  // 1. Upsert github_user for mapped users (with coordinates)
  await concurrentMap(uniquePoints, (p) =>
    prisma.gitHubUser
      .upsert({
        where: { login: p.login },
        create: {
          login: p.login,
          name: p.name,
          company: p.company,
          location: p.location,
          followers: p.followers,
          lat: p.lat,
          lng: p.lng,
          linkedinUrl: p.linkedinUrl,
          fetchedAt: new Date(),
        },
        update: {
          name: p.name,
          company: p.company,
          location: p.location,
          followers: p.followers,
          lat: p.lat,
          lng: p.lng,
          linkedinUrl: p.linkedinUrl,
          fetchedAt: new Date(),
        },
      })
      .catch(onUpsertError(`github_user mapped ${p.login}`)),
  );

  // 2. Upsert github_user for unmapped users — MUST happen before star_event (FK constraint).
  // Explicitly clears lat/lng so a user whose location changed or failed geocoding
  // no longer shows stale coordinates on the map.
  await concurrentMap(uniqueUnmapped, (u) =>
    prisma.gitHubUser
      .upsert({
        where: { login: u.login },
        create: { login: u.login, name: u.name, location: u.location, followers: u.followers, fetchedAt: new Date() },
        update: { name: u.name, location: u.location, followers: u.followers, lat: null, lng: null, fetchedAt: new Date() },
      })
      .catch(onUpsertError(`github_user unmapped ${u.login}`)),
  );

  // 3. Insert star_event atomically — single SQL statement that ensures the user exists first.
  // Using a CTE avoids any FK race condition: the user INSERT and star_event INSERT happen in
  // the same statement, on the same connection, within the same implicit transaction.
  // No amount of connection pool timing can break this.
  const ownerLc = owner.toLowerCase();
  const repoLc  = repo.toLowerCase();
  const all = [
    ...uniquePoints.map((p) => ({ login: p.login, starredAt: p.starredAt })),
    ...uniqueUnmapped.map((u) => ({ login: u.login, starredAt: u.starredAt })),
  ].filter((r): r is { login: string; starredAt: string } => r.starredAt !== null);

  await concurrentMap(all, async ({ login, starredAt }) => {
    try {
      await prisma.$executeRaw`
        WITH ensure_user AS (
          INSERT INTO github_user (login, followers, "fetchedAt")
          VALUES (${login}, 0, NOW())
          ON CONFLICT (login) DO NOTHING
        )
        INSERT INTO star_event (login, owner, repo, "starredAt", "createdAt")
        VALUES (${login}, ${ownerLc}, ${repoLc}, ${new Date(starredAt)}, NOW())
        ON CONFLICT (login, owner, repo) DO UPDATE SET "starredAt" = ${new Date(starredAt)}
      `;
    } catch (err) {
      console.warn(`  [db-warn] star_event ${login}: ${(err as Error).message}`);
    }
  });
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`\nBatch scan${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  Repos:       ${repos.length}`);
  console.log(`  Geocoding:   ${SKIP_GEOCODING ? "skipped" : "enabled"}`);
  console.log(`  Flush every: ${FLUSH_EVERY} users`);
  console.log(`  GitHub:      ${GITHUB_TOKEN ? "authenticated" : "unauthenticated (60 req/hr)"}`);
  console.log(`  DB:          ${DATABASE_URL.split("@")[1] ?? DATABASE_URL}`);
  console.log("");

  let globalRateRemaining = 5000;
  let totalGeocacheMisses = 0;

  for (let ri = 0; ri < repos.length; ri++) {
    const { owner, repo } = repos[ri];
    const prefix = `[${ri + 1}/${repos.length}] ${owner}/${repo}`;

    // Resume / delta check
    let isDelta = false;
    let deltaSince: string | undefined;
    let deltaExistingPoints:   SlimPoint[]    = [];
    let deltaExistingUnmapped: UnmappedUser[] = [];

    if (!FORCE) {
      const cached = await prisma.stargazerCache.findUnique({
        where: { owner_repo: { owner: owner.toLowerCase(), repo: repo.toLowerCase() } },
        select: { totalCount: true, scannedAt: true, latestStarredAt: true, points: true, unmapped: true },
      });
      if (cached) {
        if (!cached.latestStarredAt) {
          // No timestamp reference — cannot delta, skip
          console.log(`${prefix} — already cached (${cached.totalCount} stars, ${cached.scannedAt.toISOString().slice(0, 10)}), skipping`);
          continue;
        }
        // Delta scan — only fetch stars newer than last scan
        isDelta = true;
        deltaSince = cached.latestStarredAt.toISOString();
        deltaExistingPoints   = JSON.parse(gunzipSync(Buffer.from(cached.points   as string, "base64")).toString("utf8")) as SlimPoint[];
        deltaExistingUnmapped = JSON.parse(gunzipSync(Buffer.from(cached.unmapped as string, "base64")).toString("utf8")) as UnmappedUser[];
        console.log(`${prefix} — delta (since ${deltaSince.slice(0, 10)}, ${deltaExistingPoints.length} mapped + ${deltaExistingUnmapped.length} unmapped cached)`);
      }
    }

    console.log(`${prefix} — starting...`);

    // On --force, purge existing star_events for this repo before scanning so unstarred users
    // don't leave orphaned records. Safe because --force means "rescan from scratch".
    if (FORCE && !DRY_RUN) {
      const repoKey = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
      const deleted = await prisma.starEvent.deleteMany({ where: repoKey });
      if (deleted.count > 0) {
        console.log(`  [force] deleted ${deleted.count} stale star_events`);
      }
    }

    let allPoints:   SlimPoint[] = [];
    let allUnmapped: UnmappedUser[] = [];
    // Pending batch: accumulates since last flush, cleared on each flush.
    let pendingPoints:   SlimPoint[] = [];
    let pendingUnmapped: UnmappedUser[] = [];
    let flushedCount = 0;
    let cursor: string | null = null;
    let totalCount = 0;
    let page = 0;

    try {
      // ── Fetch all pages ──────────────────────────────────────────────────
      while (true) {
        if (globalRateRemaining < 200) {
          console.warn("  [rate-limit] Remaining < 200, pausing 60s...");
          await sleep(60_000);
        }

        const result = await fetchPage(owner, repo, cursor, isDelta ? deltaSince : undefined);
        globalRateRemaining = result.rateRemaining;
        totalCount = result.totalCount;
        page++;

        const totalPages = Math.ceil(totalCount / 100);
        process.stdout.write(
          `  page ${page}/${totalPages} — ${allPoints.length + allUnmapped.length}/${totalCount} users — GH: ${globalRateRemaining}/5000 remaining\n`,
        );

        // ── Geocode this page's users ────────────────────────────────────
        const locations = result.stargazers.map((s) => s.location ?? "").filter(Boolean);
        const geoMap    = await geocodeBulk(locations);

        const uniqueLocs = new Set(locations.map((l) => l.toLowerCase().trim()));
        const misses = [...uniqueLocs].filter((k) => isGeocodeable(k) && !geoMap.has(k)).length;
        totalGeocacheMisses += misses;

        for (const sg of result.stargazers) {
          if (allPoints.length + allUnmapped.length >= 500_000) break;

          const locKey = sg.location?.toLowerCase().trim() ?? "";
          const coords = locKey ? (geoMap.get(locKey) ?? null) : null;

          if (coords) {
            const pt: SlimPoint = {
              login:      sg.login,
              name:       sg.name,
              company:    sg.company,
              location:   sg.location,
              followers:  sg.followers,
              lat:        coords[0],
              lng:        coords[1],
              linkedinUrl: sg.linkedinUrl,
              starredAt:  sg.starredAt,
            };
            allPoints.push(pt);
            pendingPoints.push(pt);
          } else {
            const un = { login: sg.login, name: sg.name, location: sg.location, followers: sg.followers, starredAt: sg.starredAt };
            allUnmapped.push(un);
            pendingUnmapped.push(un);
          }
        }

        // ── Incremental flush every FLUSH_EVERY users ────────────────────
        const pendingTotal = pendingPoints.length + pendingUnmapped.length;
        if (!DRY_RUN && pendingTotal >= FLUSH_EVERY) {
          process.stdout.write(`  [flush] ${flushedCount + pendingTotal} users written so far...`);
          await writeUsers(owner, repo, pendingPoints, pendingUnmapped);
          process.stdout.write(` OK\n`);
          flushedCount += pendingTotal;
          pendingPoints   = [];
          pendingUnmapped = [];
        }

        if (!result.nextCursor) break;
        if (allPoints.length + allUnmapped.length >= 500_000) {
          console.warn(`\n  Cap reached (500k stars). Stopping pagination.`);
          break;
        }
        cursor = result.nextCursor;
      }

      // ── Delta merge: new results + existing cache ────────────────────────
      if (isDelta) {
        const newMappedCount   = allPoints.length;
        const newUnmappedCount = allUnmapped.length;
        const seen = new Set<string>();
        const mergedPoints:   SlimPoint[]    = [];
        const mergedUnmapped: UnmappedUser[] = [];

        // New mapped first (fresher data), then existing mapped
        for (const p of [...allPoints, ...deltaExistingPoints]) {
          if (!seen.has(p.login)) { seen.add(p.login); mergedPoints.push(p); }
        }
        // Unmapped: skip logins already in mapped set
        for (const u of [...allUnmapped, ...deltaExistingUnmapped]) {
          if (!seen.has(u.login)) { seen.add(u.login); mergedUnmapped.push(u); }
        }

        allPoints   = mergedPoints;
        allUnmapped = mergedUnmapped;
        console.log(`  +${newMappedCount} mapped +${newUnmappedCount} unmapped new → merged total: ${allPoints.length} + ${allUnmapped.length}`);
      }

      // ── Compute latestStarredAt (newest star across all data) ─────────────
      const allStarredAts = [
        ...allPoints.map((p) => p.starredAt),
        ...allUnmapped.map((u) => u.starredAt),
      ].filter((s): s is string => !!s);
      const latestStarredAt = allStarredAts.length > 0
        ? new Date(allStarredAts.sort().at(-1)!)
        : undefined;

      const mappedPct = totalCount > 0 ? Math.round((allPoints.length / totalCount) * 100) : 0;
      const countries = new Set(allPoints.map((p) => extractCountry(p.location)).filter(Boolean));
      console.log(
        `\n  Done: ${allPoints.length} mapped (${mappedPct}%) + ${allUnmapped.length} unmapped — ${countries.size} countries`,
      );

      // ── Write to DB ──────────────────────────────────────────────────────
      if (!DRY_RUN) {
        if (pendingPoints.length + pendingUnmapped.length > 0) {
          process.stdout.write("  Writing users (final batch)...");
          await writeUsers(owner, repo, pendingPoints, pendingUnmapped);
          process.stdout.write(" OK\n");
        }
        process.stdout.write("  Writing cache...");
        await writeRepoCache(owner, repo, allPoints, allUnmapped, totalCount, latestStarredAt);
        process.stdout.write(" cache OK\n");
      } else {
        console.log("  (dry-run: skipping DB writes)");
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "NOT_FOUND") {
        console.warn(`\n  [skip] ${owner}/${repo} not found (404)`);
      } else if (code === "FORBIDDEN") {
        console.warn(`\n  [skip] ${owner}/${repo} is private (403)`);
      } else {
        console.error(`\n  [error] ${owner}/${repo}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("\n─────────────────────────────────────");
  console.log("Batch scan complete.");
  if (DRY_RUN) {
    console.log(`  Estimated geocache misses: ~${totalGeocacheMisses} locations`);
    console.log("  No data was written (dry-run).");
  } else {
    console.log("  Data written to local DB.");
    console.log("  Next: sync to Neon with ./scripts/db-sync-to-neon.sh");
  }
  console.log("");

  await prisma.$disconnect();
  await pool.end();
};

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect()
    .finally(() => pool.end())
    .finally(() => process.exit(1));
});
