# StarMapper — Architecture

**Version**: 0.1.0
**Last updated**: 2026-03-27

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
| Framework | Next.js 16.2.0 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map rendering | MapLibre GL 5.x |
| Database ORM | Prisma 7.5 + `@prisma/adapter-neon` |
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
   |   [loop complete — show stats]       |                               |
   |                                      |                               |
   |-- POST /api/badge-update ----------->|-- Upsert BadgeCache --------->|
```

### Why the browser orchestrates the loop

Vercel's free tier enforces a 10-second maximum execution time per serverless function. A 2,000-star repo requires approximately 20 GitHub GraphQL calls plus geocoding — far beyond that limit.

The solution: each `/api/chunk` call processes exactly 100 users and returns within 10 seconds. The browser calls it sequentially, accumulating points on the map progressively, until `nextCursor` is `null`. No long-running server process is needed.

The browser never runs chunks concurrently. Nominatim (the last-resort geocoding fallback) enforces a 1 request/second rate limit, so sequential execution is required when both primary providers are down.

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
      api.jawg.io/places/v1/search
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

**Geocache**: A shared Neon table stores every resolved (or attempted) location. A null result for `lat`/`lng` is a valid cached entry — it means "this location does not geocode" and prevents repeated API calls for the same garbage string. The cache key is `location.toLowerCase().trim()`.

The geocache was pre-seeded with ~51,000 entries from GeoNames data (cities with population > 15,000 + country names), covering the most common GitHub profile location strings. As a result, >99% of locations resolve from cache with no external API call. The seeding script is at `scripts/seed-geocache-geonames.ts`.

**Circuit breaker**: Implemented in-memory per Vercel instance. After 3 consecutive errors, a provider is skipped for 1 hour. This protects against API outages without hard-coding fallback logic per request.

**DB resilience**: All Prisma calls in `geocoder.ts` are wrapped in `try/catch`. If Neon is down, geocoding still works via direct API calls — results just won't be cached.

**Parallelism**: When Jawg or Geoapify is available, up to 5 locations are geocoded in parallel. When both are down and Nominatim is the only option, geocoding is strictly sequential with a 1100ms delay between calls to respect the polite use policy.

---

## 5. Database Schema

StarMapper uses Prisma with `@prisma/adapter-neon`. The Neon connection string is passed via the adapter, not via a `url` field in `schema.prisma`. There are no migration files — `prisma db push` is used to sync the schema directly.

### GeoCache

```prisma
model GeoCache {
  key String  @id           // location.toLowerCase().trim()
  lat Float?                // null = "not found" (valid cached entry)
  lng Float?
}
```

**Purpose**: Cache geocoding results so the same location string is never sent to an external API twice. Shared across all repos — a Paris geocoded for one repo benefits all others. Pre-seeded with ~51,000 entries from GeoNames (see `scripts/seed-geocache-geonames.ts`).

### BadgeCache

```prisma
model BadgeCache {
  owner        String
  repo         String
  mappedCount  Int
  countryCount Int
  totalCount   Int
  updatedAt    DateTime @updatedAt

  @@id([owner, repo])       // keys stored lowercase
}
```

**Purpose**: Store pre-computed map stats so the badge SVG at `/api/badge/[owner]/[repo]` renders instantly without re-fetching stargazers. Updated via `POST /api/badge-update` after the chunk loop completes.

---

## 6. API Reference

### `POST /api/chunk`

Main data endpoint. Fetches and geocodes one page of stargazers.

**Request body**

```ts
{
  owner: string,
  repo: string,
  cursor: string | null   // null = first page; use nextCursor from previous response to paginate
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

**Exported types** (used by client):

```ts
// from src/app/api/chunk/route.ts
type StargazerPoint = {
  login: string
  lat: number
  lng: number
  // ... additional fields
}

type UnmappedUser = {
  login: string
  // ... additional fields
}
```

**Rate limit behavior**: If the GitHub GraphQL rate limit is nearly exhausted (remaining < 10), the route returns partial results with an error field rather than failing silently.

---

### `GET /api/repo-info`

Fetches repository metadata via GitHub REST API.

**Query params**: `?owner=&repo=`

**Response**

```ts
{
  name: string,
  description: string | null,
  stars: number,
  language: string | null,
  avatar: string             // owner avatar URL
}
```

---

### `POST /api/user-details`

Fetches enriched profile data for a list of stargazers (bio, followers, company). Used to populate detail cards when a user clicks a map point.

**Request headers**: `x-gh-token` (optional — falls back to server `GITHUB_TOKEN`)

**Request body**

```ts
{ logins: string[] }   // max 200 logins per request
```

**Response**

```ts
{ users: UserDetail[] }
```

`UserDetail` is exported from `src/app/api/user-details/route.ts`.

Uses GitHub REST with up to 10 concurrent requests.

---

### `GET /api/badge/[owner]/[repo]`

Serves a shield-style SVG badge showing map stats for a repo.

**Response**: `image/svg+xml`, cached 6 hours at CDN.

Reads from `BadgeCache`. If the DB is down or the repo has not been mapped yet, returns a graceful fallback SVG.

---

### `POST /api/badge-update`

Called by the browser after the chunk loop completes to persist map stats.

**Request body**

```ts
{
  owner: string,
  repo: string,
  mappedCount: number,
  countryCount: number,
  totalCount: number
}
```

**Response**: `{ ok: true }`

Performs an upsert on `BadgeCache`.

---

### `GET /api/admin/clear-geocache`

Truncates the `geocache` table. No authentication guard. Use with care.

---

### `POST /api/admin/import-geocache`

Bulk-inserts geocache entries. Used to seed the cache from an external dataset.

---

## 7. File Structure

```
/
├── src/
│   ├── app/
│   │   ├── layout.tsx                         # Root layout, global metadata
│   │   ├── globals.css                        # @theme tokens (Tailwind v4), popup styles
│   │   ├── page.tsx                           # Landing page — repo URL input form
│   │   ├── [owner]/[repo]/
│   │   │   ├── page.tsx                       # Map page — chunk loop + progressive rendering
│   │   │   └── opengraph-image.tsx            # OG image generation
│   │   └── api/
│   │       ├── chunk/route.ts                 # POST — fetch + geocode 100 stargazers
│   │       ├── repo-info/route.ts             # GET  — repo metadata (GitHub REST)
│   │       ├── user-details/route.ts          # POST — stargazer details (bio, followers)
│   │       ├── badge-update/route.ts          # POST — upsert BadgeCache
│   │       ├── badge/[owner]/[repo]/route.ts  # GET  — SVG shield badge
│   │       └── admin/
│   │           ├── clear-geocache/route.ts    # GET  — truncate geocache (admin)
│   │           └── import-geocache/route.ts   # POST — bulk import geocache (admin)
│   ├── components/
│   │   ├── token-modal.tsx                    # GitHub token input modal (PAT override)
│   │   └── map/
│   │       ├── stargazer-map.tsx              # MapLibre GL map (client component)
│   │       └── stargazer-map-dynamic.tsx      # Dynamic import wrapper — ssr: false
│   └── lib/
│       ├── db.ts                              # Prisma + Neon adapter singleton
│       ├── geocoder.ts                        # geocode() + geocodeBatch() — 3-level cascade
│       ├── github.ts                          # fetchStargazersPage() — GitHub GraphQL
│       └── bookmarks.ts                       # Client-side repo bookmarks (localStorage)
├── prisma/
│   └── schema.prisma                          # GeoCache + BadgeCache models
├── scripts/
│   ├── seed-geocache-geonames.ts              # One-shot: pre-seed geocache from GeoNames data
│   └── clean-geocache-garbage.ts              # One-shot: delete garbage entries (#, $, code artifacts)
├── docs/                                      # Project documentation
└── .env.local                                 # Local environment variables (not committed)
```

### Key module responsibilities

**`src/lib/db.ts`** — Creates a single Prisma client instance per process using the Neon adapter. Follows the Next.js singleton pattern to avoid exhausting the connection pool during hot reloads.

**`src/lib/geocoder.ts`** — Owns the entire geocoding pipeline: cache lookup, provider cascade, circuit breaker state, and cache writes. `geocode()` handles a single location; `geocodeBatch()` handles an array with appropriate concurrency control.

**`src/lib/github.ts`** — Wraps the GitHub GraphQL API. `fetchStargazersPage()` fetches one page of 100 stargazers (login, name, location only) and returns the next cursor for pagination.

**`src/app/[owner]/[repo]/page.tsx`** — The map page owns the chunk loop. It calls `/api/chunk` sequentially, accumulates `StargazerPoint[]` in state, passes the growing array to `StargazerMapDynamic`, and shows live progress.

**`src/components/map/stargazer-map.tsx`** — Initializes a MapLibre GL map, maintains a GeoJSON source named `"stargazers"`, and updates it via `source.setData()` as new points arrive. Wrapped in `React.memo` to avoid expensive re-initialization on each points update.

---

## 8. Environment Variables

| Variable | Required | Where used | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | Server | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | Server | PAT with `read:user` scope. Without it: 60 req/hr unauthenticated limit. |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Server | Geocoding primary provider (Jawg Places API) |
| `GEOAPIFY_APIKEY` | Recommended | Server | Geocoding fallback provider (Geoapify) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Browser | Used to construct the MapLibre tile style URL |
| `NEXT_PUBLIC_APP_URL` | No | Server | App base URL for metadata and OG image generation |

Without `JAWGMAP_ACCESS_TOKEN` and `GEOAPIFY_APIKEY`, all geocoding falls through to Nominatim, which is strictly sequential at 1100ms per call — noticeably slower for large repos.

**First-time database setup**:

```bash
# After setting DATABASE_URL in .env.local
npx prisma db push
```

---

## 9. Deployment Constraints

StarMapper is deployed on Vercel's free tier. The architectural decisions below exist specifically to work within those constraints.

### 10-second function timeout

Each `/api/chunk` call processes exactly 100 users. At that batch size, GitHub GraphQL + geocoding stays comfortably under 10 seconds per call. The browser loop calls them sequentially and never holds a single long connection open.

### Neon Postgres free tier

512MB storage limit. The `geocache` table is the primary consumer. Cache entries are small (key + two floats), so the limit is not a near-term concern.

### No background jobs

There is no cron, queue, or webhook infrastructure. Everything is request-driven. The browser is the scheduler.

### Rate limit table

| Service | Limit | Mitigation |
|---|---|---|
| GitHub GraphQL | 5,000 points/hr (authenticated) | Fetch only login + name + location per user (~0.1 pts/user = ~50,000 users/hr) |
| GitHub GraphQL | 60 req/hr (unauthenticated) | Server `GITHUB_TOKEN` used by default; user can provide their own via token modal |
| Jawg | No strict limit on free plan | Circuit breaker (3 errors → 1h cooldown) |
| Geoapify | 3,000 credits/day on free plan | Circuit breaker (3 errors → 1h cooldown) |
| Nominatim | 1 req/s (polite use policy) | Sequential calls with 1100ms delay |
| Vercel functions | 10s max execution | Chunk architecture; 100 users per function call |

---

## 10. Out of Scope

The following are intentionally not built and should not be added without a significant product decision:

- **Authentication or user accounts** — StarMapper is stateless and read-only by design
- **Star history over time** — storing historical snapshots is a different product (see star-history.com)
- **Real-time updates or webhooks** — no infrastructure for push-based data
- **Standalone stargazer profile pages** — detail cards on the map are in scope; separate routed pages are not
- **Server-side rate limit queuing** — the client loop handles retries and pacing
- **Fuzzy or approximate location matching** — Nominatim handles ambiguous strings natively
