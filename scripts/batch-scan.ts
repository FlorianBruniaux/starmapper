/**
 * batch-scan.ts
 *
 * Scans a list of GitHub repos and writes results to a local Postgres DB.
 * Designed to run against Docker Postgres locally (fast, free, no Neon costs).
 * After scanning, sync to Neon with: ./scripts/db-sync-to-neon.sh
 *
 * Usage:
 *   DATABASE_URL=postgresql://starmapper:starmapper@localhost:5433/starmapper \
 *   pnpm batch:scan --input scripts/repos-popular.json [--dry-run] [--force] [--skip-geocoding]
 *
 * Flags:
 *   --input <path>      JSON array of "owner/repo" strings (required)
 *   --dry-run           Preview only — no DB writes, shows geocoding budget estimate
 *   --force             Rescan repos already in stargazer_cache
 *   --skip-geocoding    Fetch GitHub data only, skip geocoding (faster, geocode on first web visit)
 *   --token <PAT>       GitHub PAT override (otherwise uses GITHUB_TOKEN from env)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";
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

// ─── Global error handlers (prevent silent crashes) ───────────────────────────

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
const DRY_RUN = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const SKIP_GEOCODING = argv.includes("--skip-geocoding");

const get = (flag: string) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : null;
};

const INPUT_FILE = get("--input");
const TOKEN_OVERRIDE = get("--token");

if (!INPUT_FILE) {
  console.error("Error: --input <repos.json> is required");
  console.error("  Example: pnpm batch:scan --input scripts/repos-popular.json");
  process.exit(1);
}

// ─── Env validation ──────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const GITHUB_TOKEN = TOKEN_OVERRIDE ?? process.env.GITHUB_TOKEN ?? "";

if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set.");
  console.error("  Set it in .env.local or prepend it:");
  console.error('  DATABASE_URL="postgresql://starmapper:starmapper@localhost:5433/starmapper" pnpm batch:scan ...');
  process.exit(1);
}

if (DATABASE_URL.includes("neon.tech") && !FORCE) {
  console.error("Warning: DATABASE_URL points to Neon production.");
  console.error("  Run against a local Docker Postgres to avoid Neon costs.");
  console.error("  Add --force to skip this check.");
  process.exit(1);
}

if (!GITHUB_TOKEN) {
  console.warn("Warning: GITHUB_TOKEN not set — limited to 60 req/hr (unauthenticated).");
}

// ─── Prisma (standard TCP via pg adapter — works with local Docker Postgres) ──
// Prisma 7 requires an adapter for non-Neon connections.
// PrismaPg uses standard TCP pg Pool — works with local Postgres and Neon alike.

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Input ───────────────────────────────────────────────────────────────────

const reposRaw = JSON.parse(readFileSync(INPUT_FILE, "utf8")) as string[];
const repos = reposRaw.map((r) => {
  const parts = r.replace(/^https?:\/\/github\.com\//, "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Invalid repo format: "${r}"`);
  return { owner: parts[0], repo: parts[1] };
});

// ─── Country extraction (inline to keep script isolated) ─────────────────────

// Country aliases (abbreviated, covers the most common cases)
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

const COUNTRY_INDICATORS = new Set([
  "afghanistan","albania","algeria","argentina","armenia","australia","austria","azerbaijan",
  "bangladesh","belgium","brazil","canada","chile","china","colombia","croatia","czechia",
  "denmark","egypt","ethiopia","finland","france","germany","ghana","greece","hungary",
  "india","indonesia","iran","iraq","ireland","israel","italy","japan","jordan","kenya",
  "malaysia","mexico","morocco","netherlands","new zealand","nigeria","norway","pakistan",
  "peru","philippines","poland","portugal","romania","russia","saudi arabia","south africa",
  "south korea","spain","sweden","switzerland","taiwan","thailand","turkey","ukraine",
  "united kingdom","united states","vietnam","united arab emirates","singapore","hong kong",
  "belgium","czech republic","slovakia","hungary","serbia","croatia","bulgaria","greece",
  "finland","norway","denmark","sweden","iceland","estonia","latvia","lithuania",
  "luxembourg","malta","cyprus","moldova","belarus","ukraine","georgia","armenia","azerbaijan",
]);

const extractCountry = (location: string | null): string | null => {
  if (!location) return null;
  const parts = location.split(",").map((p) => p.trim());
  // Try each part from the end (country usually last)
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

// ─── GitHub GraphQL (inline — needs raw headers for rate limit tracking) ─────

const GH_GRAPHQL = "https://api.github.com/graphql";

type StargazerRaw = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  starredAt: string;
};

type GHPage = {
  stargazers: StargazerRaw[];
  nextCursor: string | null;
  totalCount: number;
  rateRemaining: number;
  rateReset: number; // unix seconds
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
          }
        }
      }
    }
  }
`;

const fetchPage = async (
  owner: string,
  repo: string,
  cursor: string | null,
  attempt = 0,
): Promise<GHPage> => {
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
    const waitSec = Math.min(30 * 2 ** attempt, 300);
    console.warn(`    [network] fetch error (attempt ${attempt + 1}): ${(err as Error).message} — retry in ${waitSec}s`);
    await sleep(waitSec * 1000);
    return fetchPage(owner, repo, cursor, attempt + 1);
  }

  const rateRemaining = Number(res.headers.get("x-ratelimit-remaining") ?? 5000);
  const rateReset = Number(res.headers.get("x-ratelimit-reset") ?? 0);

  if (res.status === 403 || res.status === 429) {
    const waitMs =
      rateReset > 0
        ? Math.max(0, rateReset * 1000 - Date.now()) + 5_000
        : Math.min(60_000 * 2 ** attempt, 15 * 60 * 1000);
    const waitSec = Math.round(waitMs / 1000);
    console.warn(`    [rate-limit] ${res.status} — pausing ${waitSec}s (attempt ${attempt + 1})...`);
    await sleep(waitMs);
    return fetchPage(owner, repo, cursor, attempt + 1);
  }

  if (res.status === 404) {
    throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
  }
  if (res.status === 403 && attempt === 0) {
    throw Object.assign(new Error("forbidden"), { code: "FORBIDDEN" });
  }
  if (!res.ok) {
    throw new Error(`GitHub error ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "GraphQL error");

  const data = json.data?.repository;
  if (!data) throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });

  const page = data.stargazers;
  const stargazers: StargazerRaw[] = page.edges.map(
    (e: {
      starredAt: string;
      node: {
        login: string;
        name: string | null;
        company: string | null;
        location: string | null;
        followers: { totalCount: number };
      };
    }) => ({
      login: e.node.login,
      name: e.node.name ?? null,
      company: e.node.company ? e.node.company.trim().replace(/^@/, "") : null,
      location: e.node.location ?? null,
      followers: e.node.followers.totalCount,
      starredAt: e.starredAt,
    }),
  );

  return {
    totalCount: data.stargazerCount,
    nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
    stargazers,
    rateRemaining,
    rateReset,
  };
};

// ─── Geocoding cascade (inline — uses local prisma, no circuit breakers needed) ──

const JAWG_URL = "https://api.jawg.io/places/v1/search";
const GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Patterns that are not geocodeable locations
const NOT_GEOCODEABLE = /^(remote|earth|internet|worldwide|global|anywhere|virtual|online|distributed|nomad|moon|space|mars|[\d\s+().-]{5,}|.*@.*|.*\.(com|io|org|net|dev))/i;

const isGeocodeable = (loc: string) => loc.trim().length >= 2 && !NOT_GEOCODEABLE.test(loc.trim());

type Coords = [number, number]; // [lat, lng]

const jawgGeocode = async (loc: string): Promise<Coords | null> => {
  const token = process.env.JAWGMAP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const url = `${JAWG_URL}?text=${encodeURIComponent(loc)}&size=1&access-token=${token}`;
    const r = await fetch(url, { headers: { "User-Agent": "starmapper-batch/1.0" }, signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return null;
    const f = (await r.json()).features?.[0];
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
    const row = (await r.json()).results?.[0];
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
      headers: { "User-Agent": "starmapper-batch/1.0 (https://starmapper.app)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const row = (await r.json())[0];
    if (!row) return null;
    return [parseFloat(row.lat), parseFloat(row.lon)];
  } catch {
    return null;
  }
};

const geocodeBulk = async (
  locations: string[],
): Promise<Map<string, Coords | null>> => {
  const result = new Map<string, Coords | null>();
  const todo = locations.filter(isGeocodeable).map((l) => l.toLowerCase().trim());
  const unique = [...new Set(todo)];

  // 1. Bulk cache read
  if (unique.length > 0) {
    try {
      const rows = await prisma.geoCache.findMany({ where: { key: { in: unique } } });
      for (const row of rows) {
        result.set(row.key, row.lat !== null && row.lng !== null ? [row.lat, row.lng] : null);
      }
    } catch {
      // Cache unavailable — proceed to API calls
    }
  }

  if (SKIP_GEOCODING) return result;

  const misses = unique.filter((k) => !result.has(k));

  // 2. Cascade for misses
  for (const key of misses) {
    let coords: Coords | null = await jawgGeocode(key);
    if (!coords) coords = await geoapifyGeocode(key);
    if (!coords) coords = await nominatimGeocode(key);

    result.set(key, coords);

    if (!DRY_RUN) {
      try {
        await prisma.geoCache.upsert({
          where: { key },
          create: { key, lat: coords?.[0] ?? null, lng: coords?.[1] ?? null },
          update: { lat: coords?.[0] ?? null, lng: coords?.[1] ?? null },
        });
      } catch {
        // Non-critical — cache write failure is fine
      }
    }
  }

  return result;
};

// ─── DB writes (batched, concurrency 20 for local Postgres) ──────────────────

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
  starredAt: string | null;
};

const writeRepoCache = async (
  owner: string,
  repo: string,
  points: SlimPoint[],
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[],
  totalCount: number,
) => {
  const pointsGz = gzipSync(JSON.stringify(points)).toString("base64");
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
    create: { ...key, points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: now },
    update: { points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: now },
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
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[],
) => {
  // Upsert github_user for mapped users
  await concurrentMap(points, (p) =>
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
          fetchedAt: new Date(),
        },
        update: {
          name: p.name,
          company: p.company,
          location: p.location,
          followers: p.followers,
          lat: p.lat,
          lng: p.lng,
          fetchedAt: new Date(),
        },
      })
      .catch(() => null),
  );

  // Upsert star_event for all users
  const all = [
    ...points.map((p) => ({ login: p.login, starredAt: p.starredAt })),
    ...unmapped.map((u) => ({ login: u.login, starredAt: u.starredAt })),
  ];

  await concurrentMap(all, ({ login, starredAt }) =>
    prisma.starEvent
      .upsert({
        where: { login_owner_repo: { login, owner: owner.toLowerCase(), repo: repo.toLowerCase() } },
        create: { login, owner: owner.toLowerCase(), repo: repo.toLowerCase(), starredAt: new Date(starredAt ?? Date.now()) },
        update: { starredAt: new Date(starredAt ?? Date.now()) },
      })
      .catch(() => null),
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`\nBatch scan${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);
  console.log(`  Repos:      ${repos.length}`);
  console.log(`  Geocoding:  ${SKIP_GEOCODING ? "skipped" : "enabled"}`);
  console.log(`  GitHub:     ${GITHUB_TOKEN ? "authenticated" : "unauthenticated (60 req/hr)"}`);
  console.log(`  DB:         ${DATABASE_URL.split("@")[1] ?? DATABASE_URL}`);
  console.log("");

  let globalRateRemaining = 5000;
  let totalGeocacheMisses = 0;

  for (let ri = 0; ri < repos.length; ri++) {
    const { owner, repo } = repos[ri];
    const prefix = `[${ri + 1}/${repos.length}] ${owner}/${repo}`;

    // Resume check
    if (!FORCE && !DRY_RUN) {
      const cached = await prisma.stargazerCache.findUnique({
        where: { owner_repo: { owner: owner.toLowerCase(), repo: repo.toLowerCase() } },
        select: { totalCount: true, scannedAt: true },
      });
      if (cached) {
        console.log(`${prefix} — already cached (${cached.totalCount} stars, ${cached.scannedAt.toISOString().slice(0, 10)}), skipping`);
        continue;
      }
    }

    console.log(`${prefix} — starting...`);

    const allPoints: SlimPoint[] = [];
    const allUnmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[] = [];
    let cursor: string | null = null;
    let totalCount = 0;
    let page = 0;

    try {
      // ── Fetch all pages ──────────────────────────────────────────────────
      while (true) {
        // Proactive rate limit pause
        if (globalRateRemaining < 200) {
          console.warn("  [rate-limit] Remaining < 200, pausing 60s...");
          await sleep(60_000);
        }

        const result = await fetchPage(owner, repo, cursor);
        globalRateRemaining = result.rateRemaining;
        totalCount = result.totalCount;
        page++;

        const totalPages = Math.ceil(totalCount / 100);
        process.stdout.write(
          `  page ${page}/${totalPages} — ${allPoints.length + allUnmapped.length}/${totalCount} users — GH: ${globalRateRemaining}/5000 remaining\n`,
        );

        // ── Geocode this page's users ────────────────────────────────────
        const locations = result.stargazers
          .map((s) => s.location ?? "")
          .filter(Boolean);
        const geoMap = await geocodeBulk(locations);

        const uniqueLocs = new Set(locations.map((l) => l.toLowerCase().trim()));
        const misses = [...uniqueLocs].filter(
          (k) => isGeocodeable(k) && !geoMap.has(k),
        ).length;
        totalGeocacheMisses += misses;

        for (const sg of result.stargazers) {
          if (allPoints.length + allUnmapped.length >= 100_000) break;

          const locKey = sg.location?.toLowerCase().trim() ?? "";
          const coords = locKey ? (geoMap.get(locKey) ?? null) : null;

          if (coords) {
            allPoints.push({
              login: sg.login,
              name: sg.name,
              company: sg.company,
              location: sg.location,
              followers: sg.followers,
              lat: coords[0],
              lng: coords[1],
              starredAt: sg.starredAt,
            });
          } else {
            allUnmapped.push({
              login: sg.login,
              name: sg.name,
              followers: sg.followers,
              starredAt: sg.starredAt,
            });
          }
        }

        if (!result.nextCursor) break;
        if (allPoints.length + allUnmapped.length >= 100_000) {
          console.warn(`\n  Cap reached (100k stars). Stopping pagination.`);
          break;
        }
        cursor = result.nextCursor;
      }

      const mappedPct =
        totalCount > 0 ? Math.round((allPoints.length / totalCount) * 100) : 0;
      const countries = new Set(allPoints.map((p) => extractCountry(p.location)).filter(Boolean));
      console.log(
        `\n  Done: ${allPoints.length} mapped (${mappedPct}%) + ${allUnmapped.length} unmapped — ${countries.size} countries`,
      );

      // ── Write to DB ──────────────────────────────────────────────────────
      if (!DRY_RUN) {
        process.stdout.write("  Writing cache...");
        await writeRepoCache(owner, repo, allPoints, allUnmapped, totalCount);
        process.stdout.write(" cache OK,");
        await writeUsers(owner, repo, allPoints, allUnmapped);
        process.stdout.write(" users OK\n");
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
};

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect().finally(() => process.exit(1));
});
