# CLAUDE.md — StarMapper

This file provides guidance to Claude Code when working with code in this repository.

---

## I. Project Identity

**StarMapper** is a free tool that maps the stargazers of any GitHub repository on an interactive world map. Given a repo URL, it fetches all stargazers via the GitHub GraphQL API, geocodes their locations via Nominatim, and renders a MapLibre GL map with native GeoJSON clustering.

**Tagline**: "See who stars your repo, on a map."

**Relation to TechMapper**: StarMapper is a companion tool — same author, same map aesthetic (CARTO dark tiles, MapLibre GL), but read-only and repo-centric rather than profile-centric.

**Tech Stack**: Next.js 16.2.0 (App Router, Turbopack), TypeScript 5, MapLibre GL 5.x, Prisma 7.5 + @prisma/adapter-neon + Neon Postgres, GitHub GraphQL API + REST, Nominatim (geocoding), Tailwind CSS v4 (@theme inline), Vercel (deployment).

---

## II. Architecture (PRIORITY #1)

### Request Flow

```
User enters repo URL (landing page)
  → parse owner/repo
  → GET /api/repo-info?owner=&repo=   (GitHub REST — metadata)
  → navigate to /[owner]/[repo]
  → browser loop: POST /api/chunk { owner, repo, cursor }
      → GitHub GraphQL batch (100 users/call)
      → Nominatim geocode (with Neon geocache)
      → returns { points[], unmapped[], nextCursor, totalCount }
  → repeat until nextCursor === null
  → MapLibre GL renders points progressively
```

### Why Client-Side Chunk Loop

Vercel free tier = 10s max function duration. A 2000-star repo needs ~38 API calls. Each `/api/chunk` processes 100 users and stays under 10s. The **browser** orchestrates the loop — no long-running server function needed.

### Rate Limits (CRITICAL)

| Service | Limit | Handling |
|---------|-------|----------|
| GitHub GraphQL | 5000 pts/hr (login+name+location ≈ 0.1 pts/user) | Headers checked, 429 → wait |
| Nominatim | 1 req/s (polite use policy) | 1100ms delay between calls |
| Vercel free | 10s max per function | Chunk architecture solves this |

### Geocache

**Purpose**: Skip Nominatim calls for locations already geocoded.

**Schema**: `geocache` table — `key` (location string, lowercased) → `lat`/`lng` (nullable = "not found").

**Shared**: All repos benefit from the same cache. "Paris" geocoded once for TechMapper user = cached for StarMapper.

**Resilience**: If DB is down, geocoder falls back to direct Nominatim (no crash).

### BadgeCache

**Purpose**: Store pre-computed badge stats so badge SVG renders instantly without re-fetching all stargazers.

**Schema**: `badge_cache` table — composite PK `(owner, repo)` → `mappedCount`, `countryCount`, `totalCount`, `updatedAt`.

**Flow**: Map page calls `POST /api/badge-update` after chunk loop completes → `GET /api/badge/[owner]/[repo]` reads from cache to serve the SVG badge (cached 6h at CDN).

### Additional Endpoints

```
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
│   │   ├── layout.tsx                         # Root layout + metadata
│   │   ├── globals.css                        # @theme tokens, popup styles
│   │   ├── page.tsx                           # Landing — URL input form
│   │   ├── [owner]/[repo]/
│   │   │   ├── page.tsx                       # Map page — chunk loop + UI
│   │   │   └── opengraph-image.tsx            # OG image generation
│   │   └── api/
│   │       ├── chunk/route.ts                 # POST — fetch + geocode 100 users
│   │       ├── repo-info/route.ts             # GET  — repo metadata
│   │       ├── user-details/route.ts          # POST — stargazer details (bio, followers)
│   │       ├── badge-update/route.ts          # POST — upsert BadgeCache
│   │       ├── badge/[owner]/[repo]/route.ts  # GET  — serve SVG shield badge
│   │       └── admin/
│   │           ├── clear-geocache/route.ts    # GET  — truncate geocache (admin)
│   │           └── import-geocache/route.ts   # POST — bulk import geocache (admin)
│   ├── components/
│   │   ├── token-modal.tsx                    # GitHub token input modal
│   │   └── map/
│   │       ├── stargazer-map.tsx              # MapLibre GL component (client)
│   │       └── stargazer-map-dynamic.tsx      # Dynamic import wrapper (ssr:false)
│   └── lib/
│       ├── db.ts                              # Prisma + Neon adapter singleton
│       ├── geocoder.ts                        # geocode() + geocodeBatch() with cache
│       ├── github.ts                          # fetchStargazersPage() — GraphQL
│       └── bookmarks.ts                       # Client-side repo bookmarks
├── prisma/
│   └── schema.prisma                          # GeoCache + BadgeCache models
└── .env.local                                 # DATABASE_URL + GITHUB_TOKEN
```

---

## IV. Known Gotchas (PRIORITY #3 — read before touching anything)

### Prisma 7 + Neon Adapter Pattern

StarMapper uses the `@prisma/adapter-neon` driver adapter. This changes the setup compared to the "standard" Prisma docs.

**Key difference**: The connection string is passed via the adapter, NOT via `url` in `schema.prisma`.

```prisma
# schema.prisma — correct (no url needed with adapter)
datasource db {
  provider = "postgresql"
}
```

```ts
// db.ts — correct (adapter receives DATABASE_URL)
import { PrismaNeon } from "@prisma/adapter-neon";

const createPrismaClient = () => {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
```

**No `prisma.config.ts`** — deleted, no longer needed with the adapter pattern.

**Why adapter?** Neon uses HTTP-based serverless connections (`@neondatabase/serverless`). The adapter makes Prisma use Neon's WebSocket/HTTP transport instead of standard TCP — required for Vercel Edge/serverless.

### MapLibre GL 5.x Breaking Changes

**`getClusterExpansionZoom` is now Promise-based**, not callback-based:

```ts
// MapLibre GL 5.x — correct
source.getClusterExpansionZoom(clusterId)
  .then((zoom) => map.easeTo({ center: coords, zoom }))
  .catch(() => {});

// MapLibre GL 4.x style — will throw TS error in v5
source.getClusterExpansionZoom(clusterId, (err, zoom) => { ... });
```

### Geocoder Resilience

`geocoder.ts` wraps ALL Prisma calls in try/catch. If `DATABASE_URL` is invalid or Neon is down, the geocoder still works via direct Nominatim — it just won't cache results.

### GitHub GraphQL Cursor

`fetchStargazersPage()` returns `nextCursor: string | null`. When `null`, the loop stops. Never pass `cursor: null` to GraphQL (pass `undefined` or omit the variable).

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

---

## VI. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | PAT with `read:user` scope (without it: 60 req/hr) |
| `NEXT_PUBLIC_APP_URL` | No | App URL for metadata |

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
npx prisma studio         # GUI to inspect geocache
npx prisma generate       # Regenerate Prisma client after schema change
```

---

## VIII. Git Conventions

**Branch naming**: `feature/*`, `fix/*`, `chore/*`

**Commit scopes**:
- `map` — MapLibre component, clustering, popups
- `api` — /api/chunk, /api/repo-info routes
- `badge` — /api/badge, /api/badge-update, BadgeCache
- `geocoder` — geocoder.ts, Nominatim, geocache logic
- `github` — github.ts, GraphQL/REST queries
- `db` — schema.prisma, Prisma config, migrations
- `ui` — landing page, map page, stats panel, drawer
- `admin` — admin-only endpoints (clear-geocache, import-geocache)
- `config` — env, next.config, tsconfig, settings
- `deps` — package.json, pnpm-lock

**Format**: `type(scope): imperative lowercase message` (max 50 chars)

**Examples**:
```
feat(api): add cursor pagination to chunk endpoint
fix(db): add url to datasource in schema.prisma
perf(geocoder): batch nominatim calls with 1100ms delay
```

---

## IX. Deployment (Vercel Free)

**Constraints**: 10s function timeout → solved by chunk architecture. Neon free: 512MB.

```bash
vercel --prod
# Env vars to set in Vercel dashboard: DATABASE_URL, GITHUB_TOKEN
```

---

## X. What NOT to Build (Out of Scope)

- Auth / user accounts (StarMapper is stateless read-only)
- Storing star history over time (different product: star-history.com)
- Real-time updates / webhooks
- Full standalone stargazer profile pages (detail cards with bio/followers are in scope for map enrichment — separate pages are not)
- Server-side rate limit queuing (client loop handles retries)
- Fuzzy matching on location strings (Nominatim handles it)

---

*Last updated: 2026-03-25*
*Version: 0.1.0*
