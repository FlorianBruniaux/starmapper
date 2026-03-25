# Architecture Rules — StarMapper

## Chunk Loop Pattern (MANDATORY)

StarMapper uses client-side orchestration to stay within Vercel's 10s function limit.

```
Browser                     /api/chunk (Server)
  |                              |
  |--- POST { owner, repo } ---->|
  |                              |--- GitHub GraphQL (100 users)
  |                              |--- geocodeBatch (Nominatim + cache)
  |<-- { points[], unmapped[],   |
  |      nextCursor, total } ----|
  |                              |
  |--- POST { ..., cursor } ---->|  (repeat until nextCursor === null)
```

**Rules:**
- Each chunk = max 100 users = stays under 10s
- Browser calls sequentially (no concurrent chunks — Nominatim rate limit)
- `nextCursor === null` → stop loop, show "complete" state
- Never attempt server-side loop or streaming

## geocoder.ts Contract

```ts
// Single location → { lat, lng } | null
geocode(location: string): Promise<{ lat: number; lng: number } | null>

// Batch with rate limiting (1100ms between Nominatim calls)
geocodeBatch(locations: string[]): Promise<Map<string, { lat: number; lng: number } | null>>
```

**Rules:**
- ALL Prisma calls wrapped in try/catch — graceful degradation if DB is down
- Cache hit: return immediately, no Nominatim call
- Cache miss: call Nominatim, store result (even null = "not found" = valid cache entry)
- Empty/null location: return null immediately, don't call Nominatim

## github.ts Contract

```ts
fetchStargazersPage(
  owner: string,
  repo: string,
  cursor: string | null,  // null = first page
  token: string
): Promise<{
  stargazers: Array<{ login: string; name: string | null; location: string | null }>;
  nextCursor: string | null;
  totalCount: number;
}>
```

**Rules:**
- Never pass `cursor: null` as a GraphQL variable — omit it or pass `undefined`
- Check `X-RateLimit-Remaining` header — if < 10, return partial results with error
- GraphQL query fetches login + name + location ONLY (0.1 pts/user = ~12k users per hour)

## Prisma / DB Rules

- Uses `@prisma/adapter-neon` — connection string passed via adapter, NOT via `url` in schema
- `schema.prisma` datasource has NO `url` field — intentional with adapter pattern
- `db.ts`: `new PrismaNeon({ connectionString: process.env.DATABASE_URL })` → `new PrismaClient({ adapter })`
- No `prisma.config.ts` — deleted, not needed
- Never use `prisma migrate dev` — use `prisma db push` (no migration history needed)
- Geocache key = `location.toLowerCase().trim()` (consistent normalization)

**Models:**
- `GeoCache` — `key` (PK, lowercased location) → `lat?`, `lng?` (null = "not found" = valid cache entry)
- `BadgeCache` — composite PK `(owner, repo)` → `mappedCount`, `countryCount`, `totalCount`, `updatedAt`
  - Keys stored lowercase
  - Updated via `POST /api/badge-update` after chunk loop completes

## MapLibre GL Rules

- Source named `"stargazers"` (consistent across add/update)
- Layers: `"clusters"`, `"cluster-count"`, `"unclustered-point"` (consistent naming)
- Update data via `source.setData()` — never remove/re-add source
- Guard: `map.isStyleLoaded()` before `setData()` in useEffect
- Color scheme: blue (#58a6ff) → orange (#ffa657) → red (#f85149) based on followers

## API Routes

```
POST /api/chunk
  Body: { owner: string, repo: string, cursor: string | null }
  Returns: {
    points: StargazerPoint[],      // geocoded users
    unmapped: UnmappedUser[],      // users without location or failed geocode
    nextCursor: string | null,
    totalCount: number
  }

GET /api/repo-info
  Query: ?owner=&repo=
  Returns: { name, description, stars, language, avatar }

POST /api/user-details
  Header: x-gh-token (optional, falls back to GITHUB_TOKEN env)
  Body: { logins: string[] }  — max 200 users per request
  Returns: { users: UserDetail[] }
  Note: GitHub REST, concurrency 10 — detail cards (bio, followers, company, etc.)

GET /api/badge/[owner]/[repo]
  Returns: SVG image (Content-Type: image/svg+xml)
  Cache: public, 6h (CDN + browser)
  Note: reads BadgeCache, returns fallback SVG if DB down

POST /api/badge-update
  Body: { owner, repo, mappedCount, countryCount, totalCount }
  Returns: { ok: true }
  Note: called by browser after chunk loop completes — upserts BadgeCache

GET /api/admin/clear-geocache   — truncate geocache table (admin, no auth guard)
POST /api/admin/import-geocache — bulk-insert geocache entries (admin)
```

Export `StargazerPoint` and `UnmappedUser` types from `/api/chunk/route.ts` for client use.
Export `UserDetail` type from `/api/user-details/route.ts` for client use.

## What Stays Client-Side

- Chunk loop orchestration
- Progressive point accumulation
- "Find me" username search state
- Unmapped drawer open/close state
- Map zoom/center state

## What Stays Server-Side

- GitHub GraphQL calls (token must not be exposed)
- Nominatim calls (User-Agent header required)
- Geocache reads/writes
