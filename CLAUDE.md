# CLAUDE.md — StarMapper

This file provides guidance to Claude Code when working with code in this repository.

---

## I. Project Identity

**StarMapper** is a free tool that maps the stargazers of any GitHub repository on an interactive world map. Given a repo URL, it fetches all stargazers via the GitHub GraphQL API, geocodes their locations via a 3-tier provider cascade (Jawg → Geoapify → Nominatim), and renders a MapLibre GL map with native GeoJSON clustering.

**Tagline**: "See who stars your repo, on a map."

**Tech Stack**: Next.js 16.2.0 (App Router, Turbopack), TypeScript 5, MapLibre GL 5.x, Prisma 7.5 + @prisma/adapter-neon + Neon Postgres, GitHub GraphQL API + REST, Jawg Places API + Geoapify + Nominatim (geocoding), Tailwind CSS v4 (@theme inline), Vercel (deployment).

---

## II. Architecture (PRIORITY #1)

### Request Flow

```
User enters repo URL (landing page)
  → parse owner/repo
  → GET /api/repo-info?owner=&repo=   (GitHub REST — metadata)
  → navigate to /[owner]/[repo]
  → GET /api/stargazer-cache/[owner]/[repo]  (check DB cache)
      → 200: load full cached scan → skip chunk loop
      → 206: metadata only (too large or scan in progress)
      → 404: not cached yet
  → if no cache: browser loop: POST /api/chunk { owner, repo, cursor }
      → GitHub GraphQL batch (100 users/call)
      → 3-tier geocoding cascade (Jawg → Geoapify → Nominatim) with Neon geocache
      → returns { points[], unmapped[], nextCursor, totalCount }
  → repeat until nextCursor === null
  → MapLibre GL renders points progressively
  → POST /api/stargazer-cache  (write full scan to DB — client-side gzip)
  → POST /api/badge-update     (persist badge stats)
```

### Why Client-Side Chunk Loop

Vercel free tier = 10s max function duration. A 2000-star repo needs ~20 GitHub GraphQL calls. Each `/api/chunk` processes 100 users and stays under 10s. The **browser** orchestrates the loop — no long-running server function needed.

### Rate Limits (CRITICAL)

| Service | Limit | Handling |
|---------|-------|----------|
| GitHub GraphQL | 5000 pts/hr (login+name+location ≈ 0.1 pts/user) | Headers checked, 429 → wait |
| Jawg Places API | No strict limit on free plan | Circuit breaker: 3 errors → 1h cooldown |
| Geoapify | 3,000 credits/day on free plan | Circuit breaker: 3 errors → 1h cooldown |
| Nominatim | 1 req/s (polite use policy) | 1100ms delay between calls |
| Vercel free | 10s max per function | Chunk architecture solves this |
| Vercel free | 4.5MB max request body | Client-side gzip before cache write |

### Geocache

**Purpose**: Skip geocoding API calls for locations already resolved.

**Schema**: `geocache` table — `key` (location string, lowercased+trimmed) → `lat`/`lng` (nullable = "not found").

**Shared**: All repos benefit from the same cache. "Paris" geocoded once = cached for all future scans.

**Pre-seeded**: ~51k entries from GeoNames (cities pop >15k + country names). >99% hit rate on real scans.

**Resilience**: All Prisma calls in `geocoder.ts` are wrapped in try/catch. If DB is down, geocoder falls back to direct API calls — no crash.

### StargazerCache

**Purpose**: Cache complete scan results so subsequent visitors load the map instantly without rescanning.

**Schema**: `stargazer_cache` table — `(owner, repo)` PK → `points` (Json, gzip+base64), `unmapped` (Json, gzip+base64), `totalCount`, `scannedAt`.

**Compression**: Data is compressed client-side (Web CompressionStream API, gzip+base64) before the POST request. Reduces ~15MB raw JSON to ~800KB — necessary to stay under Vercel's 4.5MB request body limit for large repos (50k+ stars).

**Read flow**: `GET /api/stargazer-cache/[owner]/[repo]` returns 200 (full data) if cached, 206 (metadata only from BadgeCache) if badge exists but no scan cache, 404 if not found.

### BadgeCache

**Purpose**: Store pre-computed badge stats so badge SVG renders instantly without re-fetching all stargazers.

**Schema**: `badge_cache` table — composite PK `(owner, repo)` → `mappedCount`, `countryCount`, `totalCount`, `updatedAt`.

**Flow**: Map page calls `POST /api/badge-update` after chunk loop completes → `GET /api/badge/[owner]/[repo]` reads from cache to serve the SVG badge (cached 6h at CDN).

### GitHubUser + StarEvent (User-Level Cache)

**Purpose**: Normalized per-user data and star event tracking, used by `/api/stats/[owner]/[repo]` to compute aggregated stats without re-parsing the full scan.

**Schema**:
- `github_user` — `login` (PK), `name?`, `company?`, `location?`, `followers`, `lat?`, `lng?`, `fetchedAt`
- `star_event` — `id` (autoincrement), `login` → `github_user`, `owner`, `repo`, `starredAt`. Unique on `(login, owner, repo)`.

**Write path**: `src/lib/user-cache.ts` exports `bulkUpsertUsers()` and `bulkUpsertStarEvents()`. Both check `db-health.ts` before writing — if DB usage exceeds 95%, writes are skipped to prevent storage overflow.

### Additional Endpoints

```
GET /api/repos
  Returns: { repos: MappedRepo[] }
  Note: reads BadgeCache, returns up to 200 repos ordered by updatedAt desc
  Used by: landing page Community Maps table

GET /api/stats/[owner]/[repo]
  Returns: RepoStats (topCountries, topCities, topCompanies, topUsers, mappingRate...)
  Cache: public, 5min CDN
  Note: reads from GitHubUser + StarEvent tables — falls back to 404 if no user-level data

GET /api/stargazer-cache/[owner]/[repo]
  Returns: 200 { points, unmapped, totalCount, scannedAt } | 206 { lastScan } | 404
  Note: 200 = full scan data; 206 = badge metadata only (no scan cache)

POST /api/stargazer-cache
  Body: { owner, repo, pointsGz, unmappedGz, totalCount }  (new format — client-compressed)
      | { owner, repo, points, unmapped, totalCount }       (legacy format — server compresses)
  Returns: { ok: true }
  Note: upserts StargazerCache; validates totalCount ≤ 100,000

POST /api/user-details
  Header: x-gh-token (optional, falls back to server GITHUB_TOKEN)
  Body: { logins: string[] }  — max 200 users per request
  Returns: { users: UserDetail[] }
  Note: GitHub REST, concurrency 10 — for stargazer detail cards (bio, followers, etc.)

GET /api/badge/[owner]/[repo]
  Returns: SVG image (shield badge)
  Cache: public, 6h CDN — reads BadgeCache, graceful fallback if DB down

POST /api/badge-update
  Body: { owner, repo, mappedCount, countryCount, totalCount }
  Returns: { ok: true }
  Note: called by browser after chunk loop completes

GET /api/admin/clear-geocache   — admin: truncate geocache table
POST /api/admin/import-geocache — admin: bulk-import geocache entries
```

---

## III. File Map (PRIORITY #2)

```
/
├── src/
│   ├── app/
│   │   ├── layout.tsx                         # Root layout + metadata + JSON-LD + FOUC prevention script
│   │   ├── globals.css                        # @theme tokens (dark+light), popup styles
│   │   ├── page.tsx                           # Landing — URL input form + community maps
│   │   ├── [owner]/[repo]/
│   │   │   ├── page.tsx                       # Map page — chunk loop + UI + all modals
│   │   │   └── opengraph-image.tsx            # OG image generation
│   │   └── api/
│   │       ├── chunk/route.ts                 # POST — fetch + geocode 100 users
│   │       ├── repo-info/route.ts             # GET  — repo metadata (GitHub REST)
│   │       ├── repos/route.ts                 # GET  — community maps list (BadgeCache)
│   │       ├── stats/[owner]/[repo]/route.ts  # GET  — aggregated repo stats (GitHubUser+StarEvent)
│   │       ├── stargazer-cache/
│   │       │   ├── route.ts                   # POST — write full scan cache (gzip+base64)
│   │       │   └── [owner]/[repo]/route.ts    # GET  — read full scan cache
│   │       ├── user-details/route.ts          # POST — stargazer details (bio, followers)
│   │       ├── badge-update/route.ts          # POST — upsert BadgeCache
│   │       ├── badge/[owner]/[repo]/route.ts  # GET  — SVG shield badge
│   │       └── admin/
│   │           ├── clear-geocache/route.ts    # GET  — truncate geocache (admin)
│   │           └── import-geocache/route.ts   # POST — bulk import geocache (admin)
│   ├── components/
│   │   ├── token-modal.tsx                    # GitHub token input modal (PAT override)
│   │   ├── theme-toggle.tsx                   # Dark/light mode toggle button
│   │   ├── filter-combobox.tsx                # Reusable combobox for country/city filters
│   │   ├── repo-table.tsx                     # Community maps table (sortable, paginated)
│   │   ├── footer.tsx                         # Landing page footer with ecosystem links
│   │   └── map/
│   │       ├── stargazer-map.tsx              # MapLibre GL map (client component)
│   │       └── stargazer-map-dynamic.tsx      # Dynamic import wrapper (ssr: false)
│   └── lib/
│       ├── db.ts                              # Prisma + Neon adapter singleton
│       ├── db-health.ts                       # DB storage usage check (Neon 512MB limit)
│       ├── geocoder.ts                        # geocode() + geocodeBatch() — 3-tier cascade
│       ├── github.ts                          # fetchStargazersPage() — GitHub GraphQL
│       ├── bookmarks.ts                       # Client-side repo bookmarks (localStorage)
│       ├── user-cache.ts                      # bulkUpsertUsers() + bulkUpsertStarEvents()
│       ├── countries.ts                       # ISO 3166 country set + normalizeCountry()
│       └── theme.ts                           # getStoredTheme() / applyTheme() — dark/light
├── prisma/
│   └── schema.prisma                          # GeoCache + BadgeCache + StargazerCache + GitHubUser + StarEvent
├── scripts/
│   ├── seed-geocache-geonames.ts              # One-shot: pre-seed geocache from GeoNames data
│   └── clean-geocache-garbage.ts              # One-shot: delete garbage entries (#, $, code artifacts)
├── docs/                                      # Project documentation
└── .env.local                                 # Local environment variables (not committed)
```

---

## IV. Known Gotchas (PRIORITY #3 — read before touching anything)

### Prisma 7 + Neon Adapter Pattern

StarMapper supports two connection modes controlled by `DATABASE_DRIVER`:

| `DATABASE_DRIVER` | Adapter | When to use |
|---|---|---|
| `neon` (default) | `@prisma/adapter-neon` | Vercel + Neon Serverless (HTTP) |
| `standard` | `@prisma/adapter-pg` | Docker, Railway, Supabase, plain Postgres (TCP) |

**Key rule**: `schema.prisma` has no `url` field — Prisma 7 requires this when using driver adapters. The connection string is passed to the adapter in `db.ts`, not via schema. For migrations, `prisma.config.ts` provides the URL.

```prisma
# schema.prisma — correct (no url field with Prisma 7 adapter pattern)
datasource db {
  provider = "postgresql"
}
```

```ts
// db.ts — conditional adapter based on DATABASE_DRIVER env var
const createPrismaClient = () => {
  if (process.env.DATABASE_DRIVER === "standard") {
    const { Pool } = require("pg");
    const { PrismaPg } = require("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
  }
  const { PrismaNeon } = require("@prisma/adapter-neon");
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
};
```

**`prisma.config.ts`** — provides `DATABASE_URL` to Prisma CLI for `db push` / `db pull` / migrations.

### MapLibre GL 5.x Breaking Changes

**`getClusterExpansionZoom` is now Promise-based**, not callback-based:

```ts
// MapLibre GL 5.x — correct
source.getClusterExpansionZoom(clusterId)
  .then((zoom) => map.easeTo({ center: coords, zoom }))
  .catch(() => {});
```

### StargazerCache — Client-Side Compression

The write to `POST /api/stargazer-cache` sends pre-compressed data (`pointsGz`, `unmappedGz` as gzip+base64 strings). The server accepts both formats:
- New: `{ pointsGz, unmappedGz, totalCount }` (client compressed)
- Legacy: `{ points, unmapped, totalCount }` (server compresses — only for old callers)

Never send raw `points` arrays for large repos — the JSON payload will exceed Vercel's 4.5MB body limit.

### GitHub GraphQL Cursor

`fetchStargazersPage()` returns `nextCursor: string | null`. When `null`, the loop stops. Never pass `cursor: null` to GraphQL (pass `undefined` or omit the variable).

### DB Health Guard

`src/lib/user-cache.ts` calls `checkDbHealth()` before every write. If the DB is unavailable or storage exceeds 95% of the 512MB Neon free limit, writes are silently skipped. This is intentional — user-level cache is non-critical.

---

## V. Code Conventions (PRIORITY #4)

### TypeScript

- `const` arrow functions only — never `function` keyword
- `type` over `interface`
- `import type` for type-only imports
- No `any` (use `unknown` + type guards, or explicit types)
- No enums — use `as const` objects

### File Naming

kebab-case everywhere: `stargazer-map.tsx`, `stargazer-map-dynamic.tsx`, `repo-info/route.ts`

### Import Order

```ts
// --- External ---
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

// --- Internal ---
import { geocodeBatch } from "@/lib/geocoder";
import type { StargazerPoint } from "@/app/api/chunk/route";
```

### Formatting

- 2 spaces, double quotes, semicolons, trailing commas
- Line length: 100 chars max
- Prettier runs automatically on Write/Edit (hook)

### React

- `memo()` + `useCallback()` + `useMemo()` for MapLibre components (expensive renders)
- Dynamic import with `ssr: false` for ALL MapLibre components — never SSR maplibre-gl
- Never import maplibre-gl at the module level in a Server Component
- Use state initialized to SSR-safe values for anything reading `localStorage` — sync via `useEffect`

---

## VI. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | PAT with `read:user` scope (without it: 60 req/hr unauthenticated) |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg Places API — primary geocoding provider |
| `GEOAPIFY_APIKEY` | Recommended | Geoapify — geocoding fallback 1 |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for MapLibre tile style URL |
| `NEXT_PUBLIC_APP_URL` | No | App URL for metadata |

Without `JAWGMAP_ACCESS_TOKEN` and `GEOAPIFY_APIKEY`, all geocoding falls through to Nominatim — strictly sequential at 1100ms per call, noticeably slower for large repos.

**First-time DB setup:**
```bash
# After setting DATABASE_URL in .env.local
npx prisma db push
```

---

## VII. Development Commands

```bash
# Dev
pnpm dev                  # Start dev server (Turbopack)
pnpm build                # Production build

# TypeScript (prefer rtk for token efficiency)
rtk tsc                   # Type check (compressed output)
pnpm typecheck            # Full tsc --noEmit

# Database
npx prisma db push        # Sync schema to Neon (no migration files)
npx prisma studio         # GUI to inspect tables
npx prisma generate       # Regenerate Prisma client after schema change

# Scripts
pnpm seed:geonames        # Seed geocache from GeoNames (idempotent)
pnpm seed:geonames:dry    # Dry-run — preview + stats, no insert
```

---

## VIII. Git Conventions

**Branch naming**: `feature/*`, `fix/*`, `chore/*`

**Commit scopes**:
- `map` — MapLibre component, clustering, popups
- `api` — /api/chunk, /api/repo-info routes
- `badge` — /api/badge, /api/badge-update, BadgeCache
- `cache` — /api/stargazer-cache, StargazerCache, compression
- `geocoder` — geocoder.ts, Nominatim/Jawg/Geoapify, geocache logic
- `github` — github.ts, GraphQL/REST queries
- `db` — schema.prisma, Prisma config, migrations
- `ui` — landing page, map page, stats panel, drawer
- `admin` — admin-only endpoints (clear-geocache, import-geocache)
- `config` — env, next.config, tsconfig, settings
- `deps` — package.json, pnpm-lock

**Format**: `type(scope): imperative lowercase message` (max 50 chars)

---

## IX. Deployment (Vercel Free)

**Constraints**: 10s function timeout → solved by chunk architecture. 4.5MB request body limit → solved by client-side gzip. Neon free: 512MB → monitored via `db-health.ts`.

```bash
vercel --prod
# Env vars to set in Vercel dashboard: DATABASE_URL, GITHUB_TOKEN, JAWGMAP_ACCESS_TOKEN,
# GEOAPIFY_APIKEY, NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN
```

---

## X. What NOT to Build (Out of Scope)

- Auth / user accounts (StarMapper is stateless read-only)
- Storing star history over time as a primary feature (different product: star-history.com)
- Real-time updates / webhooks
- Full standalone stargazer profile pages (detail cards with bio/followers are in scope for map enrichment — separate pages are not)
- Server-side rate limit queuing (client loop handles retries)
- Fuzzy matching on location strings (Nominatim handles it)

---

*Last updated: 2026-03-27*
*Version: 0.2.0*
