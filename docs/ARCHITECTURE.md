# StarMapper Architecture

**Version**: 0.6.0
**Last updated**: 2026-06-05

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Request Flow](#3-request-flow)
4. [Geocoding Pipeline](#4-geocoding-pipeline)
5. [Database Schema](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [File Structure](#7-file-structure)
8. [Environment Variables](#8-environment-variables)
9. [Deployment Constraints](#9-deployment-constraints)
10. [Out of Scope](#10-out-of-scope)

---

## 1. Project Overview

StarMapper maps the stargazers of any GitHub repository on an interactive world map. Given a repo URL, it:

1. Fetches all stargazers via the GitHub GraphQL API (paged, 100 users per request)
2. Geocodes their profile locations through a 3-level provider cascade with shared Neon cache
3. Renders the resolved coordinates on a MapLibre GL map with native GeoJSON clustering

The tool is stateless and read-only. No authentication, no user accounts. Anyone with a GitHub repo URL can use it.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map rendering | MapLibre GL 5.24.x |
| Database ORM | Prisma 7.8 + `@prisma/adapter-neon` |
| Database | Neon Postgres (serverless) |
| Geocoding (primary) | Jawg Places API |
| Geocoding (fallback 1) | Geoapify Geocoding API |
| Geocoding (fallback 2) | Nominatim (OpenStreetMap) |
| GitHub data | GraphQL API (stargazers) + REST API (repo metadata, user details) |
| Styling | Tailwind CSS v4 (`@theme inline` tokens in `globals.css`) |
| Deployment | Vercel (free tier) |

---

## 3. Request Flow

### High-level sequence

```
Browser                             Next.js Server                  External APIs
   |                                      |                               |
   |-- Enter repo URL (landing) --------->|                               |
   |                                      |                               |
   |-- GET /api/repo-info?owner&repo ---->|-- GitHub REST (repo meta) --->|
   |<- { name, description, stars, ... } -|<------------------------------|
   |                                      |                               |
   |-- Navigate to /[owner]/[repo] ------>|                               |
   |                                      |                               |
   |-- GET /api/stargazer-cache/owner/repo|-- Neon: read StargazerCache ->|
   |<- 200 { points, unmapped, ... } -----|   (load full scan from DB)    |
   |   OR 206 { lastScan } (badge only)   |                               |
   |   OR 404 (not cached)                |                               |
   |                                      |                               |
   |  [if 200: render map immediately,    |                               |
   |   skip chunk loop]                   |                               |
   |                                      |                               |
   |-- POST /api/chunk { cursor: null } ->|-- GitHub GraphQL (100 users)->|
   |                                      |-- Geocoding cascade ---------->|
   |                                      |-- Geocache read/write ------->|
   |<- { points[], unmapped[],            |                               |
   |     nextCursor, totalCount } --------|                               |
   |                                      |                               |
   |   [render points on map]             |                               |
   |                                      |                               |
   |-- POST /api/chunk { cursor } ------->|   (repeat until              |
   |<- { ..., nextCursor: null } ---------|    nextCursor === null)       |
   |                                      |                               |
   |   [loop complete, show stats]        |                               |
   |                                      |                               |
   |-- POST /api/stargazer-cache -------->|-- Neon: upsert StargazerCache |
   |   (gzip+base64, client-compressed)   |                               |
   |                                      |                               |
   |-- POST /api/badge-update ----------->|-- Neon: upsert BadgeCache --->|
```

### Why the browser orchestrates the loop

Vercel's free tier enforces a 10-second maximum execution time per serverless function. A 2,000-star repo requires approximately 20 GitHub GraphQL calls plus geocoding, far beyond that limit.

The solution: each `/api/chunk` call processes exactly 100 users and returns within 10 seconds. The browser calls it sequentially, accumulating points on the map progressively, until `nextCursor` is `null`. No long-running server process is needed.

The browser never runs chunks concurrently. Nominatim (the last-resort geocoding fallback) enforces a 1 request/second rate limit, so sequential execution is required when both primary providers are down.

### Client-side gzip compression

After the chunk loop completes, the browser writes the full scan to `POST /api/stargazer-cache`. Raw JSON for a 50k-star repo is ~15MB, which exceeds Vercel's 4.5MB request body limit. The fix: compress client-side using the Web `CompressionStream` API (gzip+base64) before the POST, reducing the payload to ~800KB.

```
Raw points (~15MB) → TextEncoder → CompressionStream(gzip) → base64 → ~800KB
```

The server accepts both the pre-compressed format (`pointsGz`/`unmappedGz` strings) and the legacy raw format (`points`/`unmapped` arrays).

---

## 4. Geocoding Pipeline

### Provider cascade

Every unique location string goes through this cascade, stopping at the first successful result:

```
location string (from GitHub profile)
        |
        v
isGeocodeableLocation() filter
  [rejects: TLDs (.de, .local), phone prefixes (+62), URLs (://),
   code artifacts (#pnw, $home, [object Object], <html>, {{}}, \f.x, !x),
   placeholder values (null, internet, online, remote, earth, n/a...)]
        |
        v (passes filter)
  Geocache lookup (Neon DB)
        |
   cache hit -----------------------> return { lat, lng } (or null if "not found" cached)
        |
   cache miss
        |
        v
  [1] Jawg Places API
      starmapper.jawg.io (dedicated Jawg Places instance, sponsored by JawgMaps)
      Uses a dedicated geocoding token (JAWG_TOKEN_HEADER), sent as x-api-key
      header AND access-token query param (query param is used for JawgMaps usage
      stats; must be a new dedicated token from the Jawg dashboard, not the default
      account token). Separate from the map tile token (NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN).
      Batch geocoding is not permitted on the standard Jawg API; this dedicated
      instance was provided specifically for StarMapper.
      Circuit breaker: 3 errors → disabled 1h (in-memory)
      Parallel batches of 5 when available
        |
    success → store in geocache → return result
        |
    failure or breaker open
        |
        v
  [2] Geoapify Geocoding API
      api.geoapify.com/v1/geocode/search
      Circuit breaker: same pattern as Jawg
      Parallel batches of 5 when available
        |
    success → store in geocache → return result
        |
    failure or breaker open
        |
        v
  [3] Nominatim (OpenStreetMap)
      nominatim.openstreetmap.org/search
      No API key. Sequential only. 1100ms delay between calls.
        |
    success → store in geocache → return result
        |
    failure → store null in geocache → return null (unmapped)
```

### Key behaviors

**Geocache**: A shared Neon table stores every resolved (or attempted) location. A null result for `lat`/`lng` is a valid cached entry, meaning "this location does not geocode" and preventing repeated API calls for the same garbage string. The cache key is `location.toLowerCase().trim()`.

The geocache was pre-seeded with ~51,000 entries from GeoNames data (cities with population > 15,000 + country names), covering the most common GitHub profile location strings. As a result, >99% of locations resolve from cache with no external API call. The seeding script is at `scripts/backfill/seed-geocache-geonames.ts`.

**Circuit breaker**: Implemented in-memory per Vercel instance. After 3 consecutive errors, a provider is skipped for 1 hour. This protects against API outages without hard-coding fallback logic per request.

**DB resilience**: All Prisma calls in `geocoder.ts` are wrapped in `try/catch`. If Neon is down, geocoding still works via direct API calls; results just won't be cached.

**Parallelism**: When Jawg or Geoapify is available, up to 5 locations are geocoded in parallel. When both are down and Nominatim is the only option, geocoding is strictly sequential with a 1100ms delay between calls to respect the polite use policy.

**Jawg sponsorship**: The Jawg geocoding endpoint (`starmapper.jawg.io`) is a dedicated Jawg Places instance provided by JawgMaps (Jawg Places is based on Pelias). Batch geocoding is not permitted on the public Jawg API; this dedicated server exists specifically for StarMapper. The geocoding token (`JAWG_TOKEN_HEADER`) is scoped to geocoding only and cannot access tile rendering. The explore page uses a separate token (`JAWGMAP_ACCESS_TOKEN`) against the public `api.jawg.io` endpoint.

### Self-hosting without a Jawg sponsor token

If you are running StarMapper yourself, you will not have access to `starmapper.jawg.io`. The geocoder degrades gracefully:

| Available env vars | Geocoding path | Speed estimate (1000-star repo) |
|---|---|---|
| `JAWG_TOKEN_HEADER` + `GEOAPIFY_APIKEY` | Jawg (parallel) → Geoapify (parallel) → Nominatim | ~2–5 min |
| `GEOAPIFY_APIKEY` only | Geoapify (up to 5 parallel) → Nominatim | ~5–10 min |
| Neither (Nominatim only) | Sequential 1.1 s/user, ~30% hit rate via geocache | ~18 min |

**Practical advice for self-hosters:**
- Set `GEOAPIFY_APIKEY` (free plan: 3000 req/day). This covers most scans.
- Run `pnpm seed:geonames` once after DB setup. Pre-seeding ~51k common city/country names gives >99% geocache hit rate on real repos — most scans never touch the external APIs at all.
- Without `JAWGMAP_ACCESS_TOKEN`, map tiles will not render (`NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` is required for the browser). You can replace the tile source in `src/lib/map-style.ts` with any MapLibre-compatible tile provider (MapTiler, OpenMapTiles, etc.).

---

## 5. Database Schema

StarMapper uses Prisma with `@prisma/adapter-neon`. The Neon connection string is passed via the adapter, not via a `url` field in `schema.prisma`. There are no migration files; `prisma db push` is used to sync the schema directly.

### GeoCache

```prisma
model GeoCache {
  key String  @id           // location.toLowerCase().trim()
  lat Float?                // null = "not found" (valid cached entry)
  lng Float?
}
```

**Purpose**: Cache geocoding results so the same location string is never sent to an external API twice. Shared across all repos. Pre-seeded with ~51,000 entries from GeoNames.

---

### BadgeCache

```prisma
model BadgeCache {
  owner        String
  repo         String
  mappedCount  Int
  countryCount Int
  totalCount   Int
  language     String?   // primary language of the repo (from GitHub REST)
  updatedAt    DateTime  @updatedAt @default(now())

  @@id([owner, repo])       // keys stored lowercase
}
```

**Purpose**: Store pre-computed map stats so the badge SVG at `/api/badge/[owner]/[repo]` renders instantly. Updated via `POST /api/badge-update` after the chunk loop completes. Also used by `GET /api/repos` (community maps) and as a fallback metadata source when StargazerCache is missing. The `language` field is used by `--from-cache` backfill to derive developer languages without GitHub API calls.

---

### StargazerCache

```prisma
model StargazerCache {
  owner           String
  repo            String
  points          String            // gzip+base64 encoded JSON array of StargazerPoint
  unmapped        String            // gzip+base64 encoded JSON array of UnmappedUser
  totalCount      Int
  scannedAt       DateTime          @default(now())
  latestStarredAt DateTime?
  expiresAt       DateTime          @default(dbgenerated("NOW() + INTERVAL '90 days'"))

  @@id([owner, repo])
}
```

**Purpose**: Cache the full scan result so subsequent visitors load the map instantly. On read, the server decompresses and reconstructs `avatarUrl` from `login`. On write, the client compresses data client-side using Web `CompressionStream` (gzip+base64) to stay under Vercel's 4.5MB request body limit.

---

### GitHubUser

```prisma
model GitHubUser {
  login              String      @id
  name               String?
  company            String?
  location           String?
  followers          Int         @default(0)
  following          Int         @default(0)
  publicRepos        Int         @default(0)
  accountCreatedAt   DateTime?
  dataVersion        Int         @default(0)
  lat                Float?
  lng                Float?
  linkedinUrl        String?
  countryNormalized  String?
  cityNormalized     String?
  languages          String[]    @default([])
  languagesFetchedAt DateTime?
  fetchedAt          DateTime    @default(now())
  stars              StarEvent[]
}
```

**Purpose**: Normalized per-user data. Written via `bulkUpsertUsers()` in `src/lib/user-cache.ts` during each chunk. Read by `/api/stats/[owner]/[repo]` and `/api/devs`. `languages[]` is populated by the backfill pipeline (see Language Atlas).

---

### StarEvent

```prisma
model StarEvent {
  id        Int          @id @default(autoincrement())
  login     String
  owner     String
  repo      String
  starredAt DateTime
  createdAt DateTime     @default(now())
  user      GitHubUser   @relation(fields: [login], references: [login])

  @@unique([login, owner, repo])
  @@index([owner, repo])
  @@index([login])
}
```

**Purpose**: Track which user starred which repo. Enables aggregated stats per repo (`/api/stats`) and future features (star history, trending). Written via `bulkUpsertStarEvents()` in `src/lib/user-cache.ts`.

---

## 6. API Reference

### `POST /api/chunk`

Main data endpoint. Fetches and geocodes one page of stargazers.

**Request body**

```ts
{
  owner: string,
  repo: string,
  cursor: string | null   // null = first page; use nextCursor from previous response
}
```

**Response**

```ts
{
  points: StargazerPoint[],     // successfully geocoded users
  unmapped: UnmappedUser[],     // users with no location, or location that did not geocode
  nextCursor: string | null,    // null = last page, stop the loop
  totalCount: number            // total stargazers in the repo (for progress display)
}
```

Types `StargazerPoint` and `UnmappedUser` are exported from `src/app/api/chunk/route.ts`.

---

### `GET /api/repo-info`

Fetches repository metadata via GitHub REST API.

**Query params**: `?owner=&repo=`

**Response**: `{ name, description, stars, language, avatar }`

---

### `GET /api/repos`

Returns the list of already-mapped repositories for the landing page Community Maps table.

**Response**: `{ repos: MappedRepo[] }`, up to 200 repos, ordered by `updatedAt` desc.

`MappedRepo` is exported from `src/app/api/repos/route.ts`.

---

### `GET /api/stats/[owner]/[repo]`

Returns aggregated statistics for a repo, computed from the `GitHubUser` + `StarEvent` normalized tables.

**Response**: `RepoStats` (topCountries, topCities, topCompanies, topUsers, mappingRate, avgFollowers...)

**Cache**: `public, s-maxage=300` (5 min CDN).

Returns 404 if no user-level data exists for the repo (i.e., the repo has never been scanned while `GitHubUser`/`StarEvent` were active). `RepoStats` is exported from `src/app/api/stats/[owner]/[repo]/route.ts`.

---

### `GET /api/stargazer-cache/[owner]/[repo]`

Reads the full cached scan result for a repo.

**Responses**:
- `200`: `{ points, unmapped, totalCount, scannedAt }`, full data, decompressed on server
- `206`: `{ lastScan }`, scan metadata from `BadgeCache` only (no scan cache exists)
- `404`: not found in either table

---

### `POST /api/stargazer-cache`

Writes the full scan result to `StargazerCache`.

**Request body** (new format, client-compressed):
```ts
{ owner, repo, pointsGz: string, unmappedGz: string, totalCount: number }
```

**Request body** (legacy format, server compresses):
```ts
{ owner, repo, points: StargazerPoint[], unmapped: UnmappedUser[], totalCount: number }
```

Validates `totalCount ≤ 500,000`. Performs an upsert on `StargazerCache`.

---

### `POST /api/user-details`

Fetches enriched profile data for a list of stargazers (bio, followers, company). Used to populate detail cards when a user clicks a map point.

**Request headers**: `x-gh-token` (optional, falls back to server `GITHUB_TOKEN`)

**Request body**: `{ logins: string[] }`, max 200 logins per request

**Response**: `{ users: UserDetail[] }`

Uses GitHub REST with up to 10 concurrent requests. `UserDetail` is exported from `src/app/api/user-details/route.ts`.

---

### `GET /api/badge/[owner]/[repo]`

Serves a shield-style SVG badge showing map stats for a repo.

**Response**: `image/svg+xml`, cached 6 hours at CDN.

Reads from `BadgeCache`. Returns a graceful fallback SVG if DB is down or repo not found.

---

### `POST /api/badge-update`

Called by the browser after the chunk loop completes to persist map stats.

**Request body**: `{ owner, repo, mappedCount, countryCount, totalCount }`

**Response**: `{ ok: true }`

---

### `GET /api/devs/atlas`

Returns country-level language dominance data for the Language Atlas choropleth map.

**Response**: `AtlasDominantData { mode: "dominant", countries: AtlasCountry[], meta: { minDevsThreshold, generatedAt } }`

**Cache**: `public, s-maxage=3600` (1h CDN). Reads `country_language_stats_mv`. Falls back to empty response if MV is missing (graceful degradation).

---

### `GET /api/devs?language=<slug>`

Returns geocoded developer points filtered by programming language.

**Query params**: `?language=typescript` (slug format, e.g. `typescript`, `python`, `c-cpp`)

**Response**: `{ points: GeoPoint[], total: number }`, geocoded users only (`lat IS NOT NULL`), filtered by `languages[]` array.

---

### `GET /api/user-repos`

Fetches all public repos for a GitHub user via GitHub REST API (up to 500, sorted by stars). Used by the "Map a repo" modal on profile pages.

**Query params**: `?username=<login>`

**Request headers**: `x-gh-token` (optional)

**Response**: `{ repos: UserRepo[] }` — name, fullName, description, stars, language, fork.

---

### `GET /api/explore/user-repos`

Returns cached top repos for a user from the DB (`topRepos` field, 7-day TTL). Falls back to GitHub API on cache miss.

**Query params**: `?login=<login>`

**Response**: `{ repos: UserRepo[], fromCache: boolean }`

---

### `POST /api/profile/[login]/refresh`

Re-fetches a developer's GitHub data (name, location, followers, languages) and updates the DB. Also resets `topReposFetchedAt` so the next profile load re-fetches top repos from GitHub.

**Request headers**: `x-gh-token` (optional)

**Response**: `{ ok: true, updatedAt: string }` or `{ error: "cooldown", retryAfterSec: number }` (429 — 1h cooldown per user).

If the user is not in the DB, creates them on the fly (used by the profile page auto-fetch flow).

---

### `GET /api/admin/clear-geocache`

Truncates the `geocache` table. No authentication guard. Use with care.

---

### `POST /api/admin/import-geocache`

Bulk-inserts geocache entries. Used to seed the cache from an external dataset.

---

### `GET /api/admin/refresh-grid-mv`

Refreshes all materialized views (cron endpoint, runs daily at 03:00 UTC):
- `github_user_grid_mv`
- `country_stats_mv`
- `power_users_mv`
- `company_stats_mv`
- `country_language_stats_mv`

---

### `GET /api/stats/[owner]/[repo]/geo-velocity`

Returns country-level velocity data: 30-day rate vs 31–90-day historical rate, with `rising / new / stable / declining` labels. Top 20 countries.

**Cache**: `public, s-maxage=300` (5 min CDN).

---

### `GET /api/watch/[owner]/[repo]`

Live star polling endpoint. Returns new stars since a given timestamp.

**Query params**: `?since=<ISO date>`

**Response**: `{ newCount: number, countries: string[], logins: string[] }`

**Cache**: `no-store`. Uses server `GITHUB_TOKEN`, no client token forwarding.

---

### `GET /api/map-image/[owner]/[repo]`

Returns a pure SVG scatter map (800×400, equirectangular projection) for README embeds.

**Query params**: `?theme=dark|light`

**Cache**: `public, s-maxage=21600` (6h CDN).

---

### `GET /api/trending/repos`

Returns trending GitHub repos ordered by star velocity.

**Response**: `{ repos: TrendingRepo[], meta: { total } }`

**Cache**: `public, s-maxage=3600` (1h CDN). Reads `trending_repos_mv`. Returns 503 with `error:"trending_mv_empty"` if MV is missing.

---

### `GET /api/trending/map`

Returns aggregate stargazer GeoJSON points for the top 5 trending repos.

**Response**: `{ mapPoints: StargazerPoint[], meta: { total } }`

**Cache**: `public, s-maxage=3600` (1h CDN). Deduped by login across the top 5 repos. Returns 503 if MV is missing.

---

### `POST /api/news`

Publishes a short announcement (≤280 chars) for the authenticated GitHub user.

**Request headers**: `x-gh-token` (required — GitHub PAT, verified via Upstash cache)

**Response**: `{ ok: true, news: NewsItem }` or `{ error, retryAfterSec }` (24h sliding cooldown)

---

### `GET /api/news/[login]`

Returns up to 20 live news posts for a developer (soft-deleted posts excluded).

**Cache**: `public, s-maxage=300` (5 min CDN).

---

### `DELETE /api/news/item/[id]`

Soft-deletes a news post. Only the post's author can delete.

**Request headers**: `x-gh-token` (required)

---

### `GET /api/feed/[login]/rss` and `/api/feed/[login]/json`

Serve the developer's announcement feed in RSS 2.0 and JSON Feed 1.1 formats respectively.

**Cache**: `public, s-maxage=3600` (1h CDN). Supports `If-Modified-Since` / 304.

---

### `GET /api/geo/[owner]/[repo]`

API-key authenticated endpoint returning country + city aggregates for a repo.

**Request headers**: `Authorization: Bearer <api-key>`

**Response**: `{ metadata, countries: [{name, count}][], cities: [{name, count}][] }`

Rate-limited 60 req/min per IP (Upstash). Returns 404 if repo not yet scanned.

---

### `POST /api/track`

Atomic daily page view upsert (`page_view` table, `count += 1`). Fire-and-forget from client. Never returns errors.

**Request body**: `{ type: "repo" | "profile", slug: string }`

---

### `GET /api/mcp/organic-score/[owner]/[repo]`

Full organic score signal breakdown for MCP and automation use. Recomputes signals live from `badge_cache` values plus a real-time zero-follower query against `star_event + github_user`. Falls back gracefully to `zeroFollowerPct: null` on Neon timeout.

**Response**: `McpOrganicScoreResponse` with fields `score`, `tier`, `tierLabel`, `signals` (ratios + sample size), `weights`, `activeSignals`, `reasons`, `corpusAccuracy: 85.7`

**Cache**: `public, s-maxage=300, stale-while-revalidate=600`

---

### `GET /api/mcp/influential/[owner]/[repo]`

Influential stargazers above a follower threshold. Public endpoint (no auth gate), designed for MCP and automation access.

**Query params**: `?minFollowers=N` (default 500, range 0–1,000,000)

**Response**: `{ users: McpInfluentialUser[], total: number, minFollowers: number }`. Each user includes `login`, `name`, `followers`, `location`, `profileUrl`, `avatarUrl`. Hard-capped at 50 results.

---

## 7. File Structure

```
/
├── src/
│   ├── app/
│   │   ├── layout.tsx                         # Root layout, global metadata, JSON-LD, FOUC prevention
│   │   ├── globals.css                        # @theme tokens (dark + light), popup styles
│   │   ├── page.tsx                           # Landing page: repo URL input + community maps
│   │   ├── [owner]/[repo]/
│   │   │   ├── page.tsx                       # Map page: chunk loop via useScanController + delegates to sub-components
│   │   │   ├── loading.tsx                    # Next.js route-level loading skeleton
│   │   │   └── opengraph-image.tsx            # OG image generation
│   │   ├── devs/
│   │   │   ├── page.tsx                       # Dev Maps: language selector + map
│   │   │   ├── [language]/page.tsx            # Dev map filtered by language
│   │   │   └── atlas/page.tsx                 # Language Atlas: choropleth map by country
│   │   ├── feed/[login]/
│   │   │   ├── page.tsx                       # RSS subscription page (identity hero + subscribe card + news)
│   │   │   └── page.client.tsx                # Subscribe card (copy RSS/JSON URLs)
│   │   └── api/
│   │       ├── chunk/route.ts                 # POST: fetch + geocode 100 stargazers
│   │       ├── repo-info/route.ts             # GET:  repo metadata (GitHub REST)
│   │       ├── repos/route.ts                 # GET:  community maps list (BadgeCache)
│   │       ├── stats/[owner]/[repo]/
│   │       │   ├── route.ts                   # GET:  aggregated repo stats (GitHubUser + StarEvent)
│   │       │   └── geo-velocity/route.ts      # GET:  country velocity 30d vs 31–90d
│   │       ├── watch/[owner]/[repo]/route.ts  # GET:  live star polling (no-store, GitHub REST)
│   │       ├── map-image/[owner]/[repo]/route.ts # GET: SVG scatter map for README embeds
│   │       ├── trending/
│   │       │   ├── repos/route.ts             # GET:  trending repos by star velocity (1h CDN)
│   │       │   └── map/route.ts               # GET:  aggregate map points for top 5 repos (1h CDN)
│   │       ├── geo/[owner]/[repo]/route.ts    # GET:  API-key auth, country+city aggregates
│   │       ├── devs/
│   │       │   ├── route.ts                   # GET:  developer map points by language
│   │       │   └── atlas/route.ts             # GET:  country × language dominance (MV)
│   │       ├── stargazer-cache/
│   │       │   ├── route.ts                   # POST: write full scan (gzip+base64)
│   │       │   └── [owner]/[repo]/route.ts    # GET:  read full scan (200/206/404)
│   │       ├── news/
│   │       │   ├── route.ts                   # POST: publish announcement (PAT auth, 24h cooldown)
│   │       │   ├── [login]/route.ts           # GET:  list news for a developer
│   │       │   └── item/[id]/route.ts         # DELETE: soft-delete a news post
│   │       ├── feed/[login]/
│   │       │   ├── rss/route.ts               # GET:  RSS 2.0 feed (1h cache)
│   │       │   └── json/route.ts              # GET:  JSON Feed 1.1 (1h cache)
│   │       ├── user-details/route.ts          # POST: stargazer details (bio, followers)
│   │       ├── badge-update/route.ts          # POST: upsert BadgeCache
│   │       ├── badge/[owner]/[repo]/route.ts  # GET:  SVG shield badge
│   │       ├── track/route.ts                 # POST: fire-and-forget daily page view upsert
│   │       └── admin/
│   │           ├── clear-geocache/route.ts    # GET:  truncate geocache (admin)
│   │           ├── import-geocache/route.ts   # POST: bulk import geocache (admin)
│   │           └── refresh-grid-mv/route.ts   # GET:  refresh all MVs (Vercel Cron 03:00 UTC)
│   ├── components/
│   │   ├── ui/
│   │   │   └── tabs.tsx                       # Reusable Tabs component
│   │   ├── announcement-banner.tsx            # Dismissible top banner (localStorage keyed by BANNER_ID)
│   │   ├── token-modal.tsx                    # GitHub token input modal (PAT override)
│   │   ├── theme-toggle.tsx                   # Dark/light mode toggle button
│   │   ├── filter-combobox.tsx                # Reusable combobox (country/city filters)
│   │   ├── repo-table.tsx                     # Community maps table (sortable, paginated)
│   │   ├── footer.tsx                         # Landing page footer with ecosystem links
│   │   ├── news-timeline.tsx                  # News section on profile pages
│   │   ├── news-publish-modal.tsx             # Publish/delete flow + feed URLs display
│   │   └── map/
│   │       ├── stargazer-map.tsx              # MapLibre GL map (client component, React.memo)
│   │       ├── stargazer-map-dynamic.tsx      # Dynamic import wrapper, ssr: false
│   │       ├── dock.tsx                       # Vertical Dock — view controls, stats/watch/share buttons
│   │       ├── country-choropleth.tsx         # Choropleth map — stargazer density by country
│   │       ├── language-choropleth.tsx        # Choropleth map — language dominance by country
│   │       └── language-choropleth-dynamic.tsx # Dynamic import wrapper, ssr: false
│   ├── schemas/
│   │   ├── chunk.ts                           # Zod: POST /api/chunk
│   │   ├── badge-update.ts                    # Zod: POST /api/badge-update
│   │   ├── stargazer-cache.ts                 # Zod: POST /api/stargazer-cache
│   │   ├── news.ts                            # Zod: POST /api/news
│   │   ├── track.ts                           # Zod: POST /api/track
│   │   └── recalculate-location.ts            # Zod: POST /api/recalculate-location
│   ├── env.ts                                 # @t3-oss/env-nextjs — build-time validation of DATABASE_URL, GITHUB_TOKEN, NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN
│   └── lib/
│       ├── define-route.ts                    # defineRoute(schema, handler) — Zod parse wrapper for POST routes
│       ├── api-helpers.ts                     # jsonError(), logError(), getIP()
│       ├── api-validation.ts                  # validateOwnerRepo(), OWNER_REPO_RE, LOGIN_RE
│       ├── api-token.ts                       # verifyToken(), sm-token HMAC cookie
│       ├── db.ts                              # Prisma + Neon adapter singleton
│       ├── db-health.ts                       # DB storage check: checkDbHealth(), warns at 80%, skips at 95%
│       ├── geocoder.ts                        # geocode() + geocodeBatch(): 3-level cascade
│       ├── github.ts                          # fetchStargazersPage(): GitHub GraphQL
│       ├── github-auth.ts                     # verifyPat(), isValidLogin(), normalizeLogin()
│       ├── feed-builders.ts                   # buildRss20() + buildJsonFeed() — RSS 2.0 + JSON Feed 1.1
│       ├── map-style.ts                       # fetchAndPatchStyle(): Jawg tile style
│       ├── bookmarks.ts                       # Client-side repo bookmarks (localStorage)
│       ├── user-cache.ts                      # bulkUpsertUsers() + bulkUpsertStarEvents()
│       ├── repo-cache.ts                      # loadCache(), saveCache(), clearCache(), cacheKey() — localStorage helpers
│       ├── countries.ts                       # ISO 3166 country set + normalizeCountry()
│       ├── language-colors.ts                 # LANGUAGE_COLORS map (24 languages → hex)
│       └── theme.ts                           # getStoredTheme() / applyTheme() / MAP_STYLE_DARK/_LIGHT
├── mcp/                                       # starmapper-mcp: standalone npm MCP server
│   ├── package.json                           # bin: starmapper-mcp → dist/index.js
│   ├── tsconfig.json                          # CommonJS target (Node MCP runtime)
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                           # McpServer + StdioServerTransport, 5 tools wired
│       ├── client.ts                          # Typed fetch wrappers for all StarMapper API endpoints
│       └── tools/
│           ├── get_repo_stats.ts
│           ├── get_organic_score.ts
│           ├── get_velocity.ts
│           ├── get_influential_stargazers.ts
│           └── index_repo.ts                  # Drives chunk loop + saves to stargazer-cache
├── extension/                                 # Chrome Extension (Manifest V3, WXT framework)
│   ├── wxt.config.ts                          # WXT manifest + permissions
│   ├── entrypoints/
│   │   ├── background.ts                      # Service worker: context menu on right-click
│   │   ├── content.ts                         # Injected on github.com: ★ Map button + bfcache
│   │   └── popup/
│   │       ├── index.html                     # Popup UI (current repo + recent history + search)
│   │       └── main.ts                        # Popup logic (chrome.storage for recent repos)
│   └── public/icons/                          # Pre-generated PNGs (16, 48, 128px)
├── prisma/
│   ├── schema.prisma                          # GeoCache + BadgeCache + StargazerCache + GitHubUser + StarEvent + PageView
│   └── sql/
│       ├── schema-baseline.sql                # Full SQL snapshot (prisma migrate diff --from-empty)
│       └── views.sql                          # DDL for all materialized views
├── scripts/
│   ├── db/                                    # Database management
│   │   ├── db-setup.sh                        # One-shot DB bootstrap (schema push + health check)
│   │   ├── db-local-init.sh                   # Start local Docker Postgres for batch scanning
│   │   ├── db-sync-from-neon.sh               # Pull prod data → local Docker
│   │   ├── db-sync-to-neon.sh                 # Push local batch results → Neon prod
│   │   ├── setup-mvs.ts                       # Create the 7 materialized views + indexes (idempotent)
│   │   └── sql/                               # Raw DDL for each MV and index (run once per DB instance)
│   ├── backfill/                              # Data population scripts
│   │   ├── backfill-api-key-hash.ts           # Backfill keyHash on existing api_key rows
│   │   ├── backfill-organic-score.ts          # Recompute organic score + tier on badge_cache
│   │   └── seed-geocache-geonames.ts          # Pre-seed geocache from GeoNames cities15000
│   ├── ops/                                   # Ongoing operational tools
│   │   ├── batch-scan.ts                      # Batch-scan repos from a JSON list → local DB
│   │   ├── calibrate-organic-score.ts         # Grid-search organic score weights
│   │   ├── clean-geocache-garbage.ts          # Remove garbage entries from geocache
│   │   ├── collect-trending-repos.ts          # Collect trending repos via GitHub Search → JSON
│   │   ├── collect-user-repos.ts              # Collect repos from top StarMapper devs → JSON
│   │   ├── generate-api-key.ts                # Create a new GeoJSON API key in DB
│   │   ├── maintenance.sh                     # Full pipeline: backfills → sync → MV refresh
│   │   ├── probe-star-burst.ts                # Analyse star burst ratios (read-only, no writes)
│   │   └── view-stats.ts                      # Print analytics overview (last 7 days)
│   └── data/                                  # Gitignored runtime artifacts (JSON lists, seed files)
├── docs/                                      # Project documentation
└── .env.local                                 # Local environment variables (not committed)
```

### Key module responsibilities

**`src/lib/db.ts`**: Creates a single Prisma client instance per process using the Neon adapter. Follows the Next.js singleton pattern to avoid exhausting the connection pool during hot reloads.

**`src/lib/db-health.ts`**: Queries `pg_database_size` to measure Neon storage usage. Results are cached for 5 minutes in-memory. Exports `checkDbHealth()`, `DB_WARN_PCT` (80), and `DB_CRITICAL_PCT` (95).

**`src/lib/geocoder.ts`**: Owns the entire geocoding pipeline: cache lookup, provider cascade (Jawg → Geoapify → Nominatim), circuit breaker state, and cache writes. `geocode()` handles a single location; `geocodeBatch()` handles an array with appropriate concurrency control.

**`src/lib/user-cache.ts`**: Writes geocoded users and star events to the normalized `GitHubUser`/`StarEvent` tables. Both functions check `db-health.ts` and skip writes if DB storage is critical.

**`src/lib/countries.ts`**: ISO 3166-1 country name set with aliases. `isCountry(s)` checks if a string is a known country; `normalizeCountry(s)` returns a canonical English name.

**`src/lib/map-style.ts`**: Single source of truth for Jawg tile style fetching and patching. `fetchAndPatchStyle(url, projection)` fetches the JSON style, patches projection (forced to `projection` param, default `"mercator"`), patches Noto Sans → Open Sans fonts, strips `water_name`/`marine` layers, and adds `utm_source` attribution. In-memory cache keyed by `${url}#${projection}` to avoid globe/mercator collisions.

**`src/lib/theme.ts`**: Theme management: `getStoredTheme()` / `setStoredTheme()` (localStorage), `getSystemTheme()` (prefers-color-scheme), `applyTheme()` (applies class to `<html>`). Also exports `MAP_STYLE_DARK` and `MAP_STYLE_LIGHT` tile URL factories for Jawg, and the `MapProjection` type.

**`src/lib/repo-cache.ts`**: Centralizes all localStorage access for scan data. Exports `cacheKey(owner, repo)`, `loadCache()`, `saveCache()`, and `clearCache()`. Replaces scattered `localStorage.getItem/setItem` calls that were previously spread across `page.tsx`.

**`src/app/[owner]/[repo]/page.tsx`**: Orchestrates the map page at ~700 lines. Delegates the chunk loop to the `useScanController` hook and renders each modal/overlay as a dedicated sub-component. No longer contains inline modal JSX; it composes `StatsModal`, `ShareModal`, `BadgeModal`, `GrowthModal`, `AllStargazersModal`, `RateLimitOverlay`, and `PreScanOverlay`.

**`src/components/map/stargazer-map.tsx`**: Initializes a MapLibre GL map, maintains a GeoJSON source named `"stargazers"`, and updates it via `source.setData()` as new points arrive. Wrapped in `React.memo` to avoid expensive re-initialization on each points update.

---

## 8. Environment Variables

| Variable | Required | Where used | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | Server | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | Server | PAT with `read:user` scope. Without it: 60 req/hr unauthenticated limit. |
| `JAWG_TOKEN_HEADER` | Recommended | Server | Main stargazer geocoding, dedicated Jawg Places instance (`starmapper.jawg.io`). Sent as `x-api-key` header + `access-token` query param. |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Server | Explore page autocomplete + reverse geocoding (`api.jawg.io`). Also used by `batch-scan.ts`. |
| `GEOAPIFY_APIKEY` | Recommended | Server | Geocoding fallback provider (Geoapify) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Browser | Used to construct the MapLibre tile style URL (primary Jawg token) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2` | No | Browser | Jawg fallback token — auto-used when the primary returns 401/402/403/429 (Map Views limit) |
| `NEXT_PUBLIC_APP_URL` | No | Server | App base URL for metadata and OG image generation |

Without `JAWG_TOKEN_HEADER` and `GEOAPIFY_APIKEY`, all stargazer geocoding falls through to Nominatim, which is strictly sequential at 1100ms per call, noticeably slower for large repos.

---

## 9. Deployment Constraints

StarMapper is deployed on Vercel's free tier. The architectural decisions below exist specifically to work within those constraints.

### 10-second function timeout

Each `/api/chunk` call processes exactly 100 users. At that batch size, GitHub GraphQL + geocoding stays comfortably under 10 seconds per call. The browser loop calls them sequentially and never holds a single long connection open.

### 4.5MB request body limit

`POST /api/stargazer-cache` receives the full scan data. Raw JSON for large repos (50k+ stars) exceeds 4.5MB. Solution: the browser compresses data client-side with `CompressionStream("gzip")` + base64 encoding before sending. This reduces ~15MB to ~800KB.

### Neon Postgres (sponsored plan)

Neon sponsors StarMapper with a 100GB plan. `db-health.ts` still monitors usage in real-time and exposes configurable thresholds via `DB_STORAGE_LIMIT_MB` (default: 512 for self-hosters). When usage exceeds 80%, a warning is logged; at 95%, user cache writes (`GitHubUser`/`StarEvent`) are skipped. The `geocache` and `stargazer_cache` tables are the primary consumers.

### No background jobs

There is no cron, queue, or webhook infrastructure. Everything is request-driven. The browser is the scheduler.

### Rate limit table

| Service | Limit | Mitigation |
|---|---|---|
| GitHub GraphQL | 5,000 points/hr (authenticated) | Fetch only login + name + location per user (~0.1 pts/user) |
| GitHub GraphQL | 60 req/hr (unauthenticated) | Server `GITHUB_TOKEN` used by default; user can provide their own via token modal |
| Jawg | No strict limit on free plan | Circuit breaker (3 errors → 1h cooldown) |
| Geoapify | 3,000 credits/day on free plan | Circuit breaker (3 errors → 1h cooldown) |
| Nominatim | 1 req/s (polite use policy) | Sequential calls with 1100ms delay |
| Vercel functions | 10s max execution | Chunk architecture; 100 users per function call |
| Vercel functions | 4.5MB max request body | Client-side gzip before cache write |

---

## 10. Out of Scope

The following are intentionally not built and should not be added without a significant product decision:

- **Authentication or user accounts**: StarMapper is stateless and read-only by design
- **Star history over time as a primary feature**: storing historical snapshots is a different product (see star-history.com). Note: `StarEvent` table captures star dates as a side-effect of scanning, but no UI surfaces this data yet.
- **Real-time updates or webhooks**: no infrastructure for push-based data
- **Standalone stargazer profile pages**: detail cards on the map are in scope; separate routed pages are not
- **Server-side rate limit queuing**: the client loop handles retries and pacing
- **Fuzzy or approximate location matching**: Nominatim handles ambiguous strings natively
