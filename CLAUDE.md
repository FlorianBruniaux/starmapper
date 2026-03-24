# CLAUDE.md — StarMapper

This file provides guidance to Claude Code when working with code in this repository.

---

## I. Project Identity

**StarMapper** is a free tool that maps the stargazers of any GitHub repository on an interactive world map. Given a repo URL, it fetches all stargazers via the GitHub GraphQL API, geocodes their locations via Nominatim, and renders a MapLibre GL map with native GeoJSON clustering.

**Tagline**: "See who stars your repo, on a map."

**Relation to TechMapper**: StarMapper is a companion tool — same author, same map aesthetic (CARTO dark tiles, MapLibre GL), but read-only and repo-centric rather than profile-centric.

**Tech Stack**: Next.js 16.2.0 (App Router, Turbopack), TypeScript 5, MapLibre GL 5.x, Prisma 7 + Neon Postgres (geocache only), GitHub GraphQL API, Nominatim (geocoding), Tailwind CSS, Vercel (deployment).

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

**Schema**: Single `geocache` table — `key` (location string, lowercased) → `lat`/`lng` (nullable = "not found").

**Shared**: All repos benefit from the same cache. "Paris" geocoded once for TechMapper user = cached for StarMapper.

**Resilience**: If DB is down, geocoder falls back to direct Nominatim (no crash).

---

## III. File Map (PRIORITY #2)

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # Landing — URL input form
│   │   ├── [owner]/[repo]/page.tsx      # Map page — chunk loop + UI
│   │   └── api/
│   │       ├── chunk/route.ts           # POST — fetch + geocode 100 users
│   │       └── repo-info/route.ts       # GET  — repo metadata
│   ├── components/
│   │   └── map/
│   │       ├── stargazer-map.tsx         # MapLibre GL component (client)
│   │       └── stargazer-map-dynamic.tsx # Dynamic import wrapper (ssr:false)
│   └── lib/
│       ├── db.ts                        # PrismaClient singleton
│       ├── geocoder.ts                  # geocode() + geocodeBatch() with cache
│       └── github.ts                    # fetchStargazersPage() — GraphQL
├── prisma/
│   ├── schema.prisma                    # GeoCache model only
│   └── migrations/
├── prisma.config.ts                     # Prisma 7 config
└── .env.local                           # DATABASE_URL + GITHUB_TOKEN
```

---

## IV. Known Gotchas (PRIORITY #3 — read before touching anything)

### Prisma 7 Breaking Changes

1. **`schema.prisma` MUST have `url = env("DATABASE_URL")`** in the datasource block. Without it, `PrismaClient()` throws at boot even before connecting.

2. **`PrismaClient` constructor does NOT accept `datasourceUrl`** in v7. The URL comes from the schema/env only.

3. **`prisma.config.ts`** uses `datasource: { url: ... }` (not `datasourceUrl` at root level).

```prisma
# schema.prisma — correct
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

```ts
// db.ts — correct
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
```

```ts
// prisma.config.ts — correct
export default defineConfig({
  datasource: { url: process.env.DATABASE_URL },
});
```

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
- `geocoder` — geocoder.ts, Nominatim, geocache logic
- `github` — github.ts, GraphQL queries
- `db` — schema.prisma, Prisma config, migrations
- `ui` — landing page, map page, stats panel, drawer
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
- Individual stargazer profile pages
- Server-side rate limit queuing (client loop handles retries)
- Fuzzy matching on location strings (Nominatim handles it)

---

*Last updated: 2026-03-22*
*Version: 0.1.0*
