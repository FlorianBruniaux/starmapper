# CLAUDE.md — StarMapper

This file provides guidance to Claude Code when working with code in this repository.

---

## I. Project Identity

**StarMapper** is a free tool that maps the stargazers of any GitHub repository on an interactive world map. Given a repo URL, it fetches all stargazers via the GitHub GraphQL API, geocodes their locations via a 3-tier provider cascade (Jawg → Geoapify → Nominatim), and renders a MapLibre GL map with native GeoJSON clustering.

**Tagline**: "See who stars your repo, on a map."

**Tech Stack**: Next.js 16.2.3 (App Router, Turbopack), TypeScript 5, MapLibre GL 5.x, Prisma 7.7.0 + @prisma/adapter-neon + Neon Postgres, GitHub GraphQL API + REST, Jawg Places API + Geoapify + Nominatim (geocoding), Tailwind CSS v4 (@theme inline), Vercel (deployment).

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

Vercel Hobby default function duration = 10s, configurable up to 60s (or 300s with Fluid Compute on Node.js). A 2000-star repo needs ~20 GitHub GraphQL calls. Each `/api/chunk` processes 100 users. With Nominatim-only fallback at 1100ms × 100 users = ~110s, the chunk architecture is still necessary even at 60s. The **browser** orchestrates the loop — no long-running server function needed.

### Rate Limits (CRITICAL)

| Service | Limit | Handling |
|---------|-------|----------|
| GitHub GraphQL | 5000 pts/hr (login+name+location ≈ 0.1 pts/user) | Headers checked, 429 → wait |
| Jawg Places API | No strict limit on free plan | Circuit breaker: 3 errors → 1h cooldown |
| Geoapify | 3,000 credits/day on free plan | Circuit breaker: 3 errors → 1h cooldown |
| Nominatim | 1 req/s (polite use policy) | 1100ms delay between calls |
| Vercel Hobby | 10s default, 60s max (300s with Fluid Compute) | Chunk architecture solves this — Nominatim-only path = ~110s/chunk even à 60s |
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
- `github_user` — `login` (PK), `name?`, `company?`, `location?`, `followers`, `lat?`, `lng?`, `languages String[]`, `languagesFetchedAt?`, `topRepos Json?` (UserRepo[], max 8), `topReposFetchedAt?`, `fetchedAt`
- `star_event` — `id` (autoincrement), `login` → `github_user`, `owner`, `repo`, `starredAt`. Unique on `(login, owner, repo)`.

**Write path**: `src/lib/user-cache.ts` exports `bulkUpsertUsers()` and `bulkUpsertStarEvents()`. Both check `db-health.ts` before writing — if DB usage exceeds 95%, writes are skipped to prevent storage overflow.

### PageView (Analytics)

**Purpose**: Track daily page views per repo and profile for internal analytics. Private — not exposed in UI, queryable via `pnpm stats:views`.

**Schema**: `page_view` — composite PK `(type, slug, date)` → `count Int`. `type` = `"repo"` | `"profile"` | `"feed_rss"`. `slug` = `"owner/repo"` or `"login"`. `date` = UTC day (Date only, no time).

**Write path**: `POST /api/track` — atomic upsert (`INSERT ... ON CONFLICT DO UPDATE SET count = count + 1`). Called fire-and-forget from both `/[owner]/[repo]/page.tsx` and `/profile/[login]/page.tsx` on mount.

**Read path**: `pnpm stats:views [--user login] [--slug owner/repo] [--days N] [--top N]` — terminal output with bar charts.

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
  Note: upserts StargazerCache; validates totalCount ≤ 500,000

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

GET /api/trending
  Returns: TrendingResponse { repos: TrendingRepo[], mapPoints: StargazerPoint[], meta: { total } }
  Cache: public, 1h CDN (s-maxage=3600)
  Note: reads trending_repos_mv — returns 503 with error:"trending_mv_empty" if MV missing.
        mapPoints = aggregate of top 10 repos' stargazer_cache (deduped by login).
        TrendingRepo.hasMap = true if repo has a stargazer_cache entry.

GET /api/devs/atlas
  Returns: AtlasDominantData { countries: CountryDominant[], meta: { generatedAt, minDevsThreshold } }
  Cache: public, 6h CDN
  Note: reads country_language_stats_mv — falls back to {} if MV missing

GET /api/devs?language=<slug>
  Returns: { points: GeoPoint[], total: number }
  Note: reads github_user filtered by language (from languages[]), geocoded users only

POST /api/profile/[login]/refresh
  Header: x-gh-token (optional)
  Returns: RefreshResponse { ok: true; updatedAt: string } | { error: string; retryAfterSec?: number }
  Note: re-fetches from GitHub REST + GraphQL, geocodes if location changed. Cooldown 1h (fetchedAt).
        If user not in DB → creates them on the fly (used by profile page auto-fetch on 404).

POST /api/track
  Body: { type: "repo" | "profile", slug: string }
  Returns: { ok: true }
  Note: atomic daily upsert on page_view table (count += 1). Fire-and-forget from client.
        Never returns errors — silently succeeds even if DB write fails.

POST /api/news
  Header: x-gh-token (required — GitHub PAT)
  Body: { body: string (max 280), url?: string }
  Returns: { ok: true, news: NewsItem } | { error: string, retryAfterSec?: number }
  Note: publishes an announcement for the authenticated GitHub user. Sliding 24h cooldown
        (includes soft-deleted posts). PAT verified via GitHub REST API, cached 5min in Upstash.

GET /api/news/[login]
  Returns: { items: NewsItem[], hasMore: boolean }
  Cache: public, 5min CDN
  Note: returns up to 20 live posts (deletedAt = null), ordered desc.

DELETE /api/news/item/[id]
  Header: x-gh-token (required)
  Returns: { ok: true }
  Note: soft-delete (sets deletedAt). Only the post's author can delete.

GET /api/feed/[login]/rss
  Returns: RSS 2.0 XML (Content-Type: application/rss+xml)
  Cache: public, 1h CDN — supports If-Modified-Since / 304
  Note: tracks subscriber hits in page_view (type: "feed_rss"). Falls back to 404 if user unknown.

GET /api/feed/[login]/json
  Returns: JSON Feed 1.1 object (Content-Type: application/feed+json)
  Cache: public, 1h CDN
  Note: same data as RSS feed, JSON Feed 1.1 format.

GET /api/geo/[owner]/[repo]
  Header: Authorization: Bearer <api-key>
  Returns: { metadata: { owner, repo, totalCount, geocodedCount, scannedAt, apiVersion }, countries: [{name, count}][], cities: [{name, count}][] }
  Cache: private, no-store
  Note: API key authenticated (ApiKey model). Looks up by keyHash (SHA-256) first, falls back
        to plaintext key during migration. Decompresses stargazer_cache gzip+base64 in Node,
        aggregates country/city top-50 in-memory. Rate-limited 60 req/min per IP (Upstash).
        Returns 404 if repo not yet scanned. See scripts/backfill-api-key-hash.ts.

GET /api/stats/[owner]/[repo]/geo-velocity
  Returns: { items: GeoVelocityItem[] }
  Cache: public, 5min CDN
  Note: raw SQL on star_event × github_user. Computes 30d vs 31–90d daily rate ratio.
        Trend: rising (≥1.5×), new (no history), stable, declining (≤0.5×). Top 20 countries.

GET /api/watch/[owner]/[repo]?since=<ISO>
  Returns: WatchResult { newCount: number, countries: string[], logins: string[] }
  Cache: no-store
  Note: GitHub REST GET /repos/.../stargazers with Accept: vnd.github.v3.star+json.
        Filters to starred_at > since. Looks up countryNormalized from github_user (no Nominatim).
        Uses server GITHUB_TOKEN (no client token forwarding).

GET /api/map-image/[owner]/[repo]?theme=dark|light
  Returns: SVG image (800×400, equirectangular projection)
  Cache: public, 6h CDN (revalidate: 21600)
  Note: pure SVG, no external font deps. Land path pre-computed at module load from world-atlas.
        Points sampled to ≤2500 for SVG size. Embeddable via <picture> for dark/light themes.
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
│   │   ├── devs/
│   │   │   ├── page.tsx                       # Dev Maps landing — language selector
│   │   │   ├── [language]/page.tsx            # Dev map filtered by language
│   │   │   └── atlas/page.tsx                 # Language Atlas — choropleth map by country
│   │   ├── feed/
│   │   │   └── [login]/
│   │   │       ├── page.tsx                   # Subscription page — identity hero + subscribe card + news list
│   │   │       └── page.client.tsx            # Subscribe card (copy RSS/JSON URLs)
│   │   └── api/
│   │       ├── chunk/route.ts                 # POST — fetch + geocode 100 users
│   │       ├── repo-info/route.ts             # GET  — repo metadata (GitHub REST)
│   │       ├── repos/route.ts                 # GET  — community maps list (BadgeCache)
│   │       ├── stats/[owner]/[repo]/route.ts  # GET  — aggregated repo stats (GitHubUser+StarEvent)
│   │       │   ├── geo-velocity/route.ts      # GET  — country velocity (30d vs 31-90d rate ratio)
│   │       │   └── top-users/route.ts         # GET  — top 60 users by followers
│   │       ├── watch/[owner]/[repo]/route.ts  # GET  — live star polling (GitHub REST, no-store)
│   │       ├── map-image/[owner]/[repo]/route.ts # GET — SVG scatter map for README embeds
│   │       ├── devs/
│   │       │   ├── route.ts                   # GET  — dev map points filtered by language
│   │       │   └── atlas/route.ts             # GET  — country × language aggregation (MV)
│   │       ├── stargazer-cache/
│   │       │   ├── route.ts                   # POST — write full scan cache (gzip+base64)
│   │       │   └── [owner]/[repo]/route.ts    # GET  — read full scan cache
│   │       ├── news/
│   │       │   ├── route.ts                   # POST — publish announcement (PAT auth, 24h cooldown)
│   │       │   ├── [login]/route.ts           # GET  — list news for a developer (public, 5min cache)
│   │       │   └── item/[id]/route.ts         # DELETE — soft-delete a news post (author only)
│   │       ├── feed/
│   │       │   └── [login]/
│   │       │       ├── rss/route.ts           # GET  — RSS 2.0 feed (1h cache, If-Modified-Since)
│   │       │       └── json/route.ts          # GET  — JSON Feed 1.1 (1h cache)
│   │       ├── user-details/route.ts          # POST — stargazer details (bio, followers)
│   │       ├── badge-update/route.ts          # POST — upsert BadgeCache
│   │       ├── badge/[owner]/[repo]/route.ts  # GET  — SVG shield badge
│   │       └── admin/
│   │           ├── clear-geocache/route.ts    # GET  — truncate geocache (admin)
│   │           ├── import-geocache/route.ts   # POST — bulk import geocache (admin)
│   │           └── refresh-grid-mv/route.ts   # GET  — refresh all materialized views (cron)
│   ├── components/
│   │   ├── announcement-banner.tsx            # Dismissible top banner for new features (localStorage per BANNER_ID)
│   │   ├── token-modal.tsx                    # GitHub token input modal (PAT override)
│   │   ├── theme-toggle.tsx                   # Dark/light mode toggle button
│   │   ├── filter-combobox.tsx                # Reusable combobox for country/city filters
│   │   ├── repo-table.tsx                     # Community maps table (sortable, paginated)
│   │   ├── footer.tsx                         # Landing page footer with ecosystem links
│   │   ├── news-timeline.tsx                  # NewsTimeline — news section on profile pages (owner publish + public view)
│   │   ├── news-publish-modal.tsx             # NewsPublishModal — publish/delete flow + feed URLs display
│   │   └── map/
│   │       ├── stargazer-map.tsx              # MapLibre GL map (client component)
│   │       ├── stargazer-map-dynamic.tsx      # Dynamic import wrapper (ssr: false)
│   │       ├── dock.tsx                       # Vertical Dock — view controls, stats/growth/watch/share buttons
│   │       ├── country-choropleth.tsx         # Choropleth map — stargazer density by country
│   │       ├── language-choropleth.tsx        # Choropleth map — language by country
│   │       └── language-choropleth-dynamic.tsx # Dynamic import wrapper (ssr: false)
│   ├── schemas/
│   │   ├── track.ts                           # Zod schema — POST /api/track
│   │   ├── vitals.ts                          # Zod schema — POST /api/vitals
│   │   ├── recalculate-location.ts            # Zod schema — POST /api/recalculate-location
│   │   ├── badge-update.ts                    # Zod schema — POST /api/badge-update
│   │   ├── chunk.ts                           # Zod schema — POST /api/chunk
│   │   ├── news.ts                            # Zod schema — POST /api/news
│   │   └── stargazer-cache.ts                 # Zod schema — POST /api/stargazer-cache (envelope)
│   └── lib/
│       ├── define-route.ts                    # defineRoute(schema, handler, opts?) — Zod JSON-parse + safeParse wrapper for POST routes
│       ├── api-helpers.ts                     # jsonError(), logError(), getIP() — shared route utilities
│       ├── api-validation.ts                  # validateOwnerRepo(), OWNER_REPO_RE, LOGIN_RE — path-param validation
│       ├── api-token.ts                       # verifyToken(), COOKIE_NAME — sm-token HMAC cookie
│       ├── db.ts                              # Prisma + Neon adapter singleton
│       ├── db-health.ts                       # DB storage usage check (Neon 512MB limit)
│       ├── geocoder.ts                        # geocode() + geocodeBatch() — 3-tier cascade
│       ├── github.ts                          # fetchStargazersPage() — GitHub GraphQL
│       ├── github-auth.ts                     # verifyPat() — GitHub PAT verification + Upstash cache; isValidLogin() / normalizeLogin()
│       ├── feed-builders.ts                   # buildRss20() + buildJsonFeed() — RSS 2.0 and JSON Feed 1.1 builders
│       ├── map-style.ts                       # fetchAndPatchStyle() — single source for Jawg tile style patching
│       ├── bookmarks.ts                       # Client-side repo bookmarks (localStorage)
│       ├── user-cache.ts                      # bulkUpsertUsers() + bulkUpsertStarEvents()
│       ├── countries.ts                       # ISO 3166 country set + normalizeCountry()
│       ├── language-colors.ts                 # LANGUAGE_COLORS map (24 languages → hex)
│       └── theme.ts                           # getStoredTheme() / applyTheme() — dark/light
├── prisma/
│   └── schema.prisma                          # GeoCache + BadgeCache + StargazerCache + GitHubUser + StarEvent + PageView
├── scripts/
│   ├── batch-scan.ts                          # Batch-scan repos from a JSON list (uses starmapper.jawg.io)
│   ├── backfill-languages.ts                  # Backfill languages[] on github_user (--from-cache or GitHub API)
│   ├── backfill-linkedin.ts                   # Backfill linkedinUrl on github_user via GitHub social accounts
│   ├── backfill-repo-languages.ts             # Backfill language field on badge_cache via GitHub REST
│   ├── collect-user-repos.ts                  # Collect repos from top StarMapper devs → JSON for batch-scan
│   ├── collect-trending-repos.ts              # Collect trending repos via GitHub Search API → JSON for batch-scan
│   ├── seed-geocache-geonames.ts              # One-shot: pre-seed geocache from GeoNames data
│   ├── clean-geocache-garbage.ts              # One-shot: delete garbage entries (#, $, code artifacts)
│   ├── fix-bad-locations.ts                   # One-shot: null out bad lat/lng (IPs, timezone codes, paths)
│   ├── fix-slash-locations.ts                 # One-shot: re-geocode slash-separated city strings
│   ├── create-country-language-mv.sql         # Create country_language_stats_mv (run once per DB instance)
│   └── db-sync-to-neon.sh                     # Sync local Docker → Neon prod (github_user, star_event, badge_cache…)
├── docs/                                      # Project documentation
└── .env.local                                 # Local environment variables (not committed)
```

---

## IV. Known Gotchas (PRIORITY #3 — read before touching anything)

### ApiKey — SHA-256 hashing migration

The `ApiKey` model stores keys as UUIDs. The `keyHash` field (SHA-256 hex of `key`) was added as an optional unique column. The geo route (`/api/geo/[owner]/[repo]/route.ts`) looks up by `keyHash` first, falls back to plaintext `key` during transition.

**After any `prisma db push`**, run the backfill to populate `keyHash` for existing rows:
```bash
pnpm backfill:api-key-hash        # local Docker
pnpm backfill:api-key-hash:prod   # Neon prod (requires DATABASE_URL in env)
```

When **creating new API keys**, always store `keyHash = hashApiKey(key)` (`src/lib/api-key.ts`) — never store the raw key in a way that's returned to a client.

### AnnouncementBanner — BANNER_ID lifecycle

`src/components/announcement-banner.tsx` shows a dismissible top banner. Dismissal is stored in `localStorage` keyed by `BANNER_ID`. To make the banner reappear for users who already dismissed it (i.e., when announcing a new feature), **bump `BANNER_ID`** to a new unique string.

```ts
// Inside announcement-banner.tsx
const BANNER_ID = "announce-explore-v1"; // bump → "announce-explore-v2" for next announcement
const LINKS: LinkItem[] = [              // update links/labels to match the new feature
  { label: "...", href: "..." },
];
```

A `PostToolUse` hook (`banner-reminder.sh`) fires automatically when a new `page.tsx` or `route.ts` is created as a reminder to update this file if the new feature is worth announcing.

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

### Neon DDL Constraints

**`CREATE INDEX CONCURRENTLY` is incompatible with Neon storage** — triggers `PANIC: [NEON_SMGR] Page evicted with zero LSN`. Always use regular `CREATE INDEX` (without `CONCURRENTLY`) for DDL on Neon.

**Statement timeout** — Neon applies a session-level statement timeout that cancels long DDL operations (index builds, MV creation). Always prefix DDL scripts with `SET statement_timeout = 0;`.

### Materialized Views — One-Time Setup Required

Five MVs are not managed by Prisma and must be created manually on any new DB instance. `pnpm db:sync` creates/refreshes them automatically when syncing from local Docker.

**`github_user_grid_mv`** — heatmap grid (lat/lng buckets + follower aggregation):
```sql
-- see scripts/create-grid-mv.sql if it exists, or check git history
```

**`country_stats_mv`** — country aggregation (replaces 9s full-scan on 4.3M rows):
```sql
CREATE MATERIALIZED VIEW country_stats_mv AS
  SELECT "countryNormalized" AS country, COUNT(*) AS cnt
  FROM github_user
  WHERE "countryNormalized" IS NOT NULL
    AND "countryNormalized" NOT LIKE 'http%'
  GROUP BY "countryNormalized"
  ORDER BY cnt DESC;

CREATE UNIQUE INDEX country_stats_mv_country_idx ON country_stats_mv (country);
```

**`power_users_mv`** — star_event aggregation (replaces timeout on 11.9M rows, fixes Power tab):
```sql
CREATE MATERIALIZED VIEW power_users_mv AS
  SELECT login, COUNT(*) AS cnt
  FROM star_event
  GROUP BY login
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC, login ASC;

CREATE UNIQUE INDEX power_users_mv_login_idx ON power_users_mv (login);
CREATE INDEX power_users_mv_cnt_login_idx ON power_users_mv (cnt DESC, login ASC);
```

**`company_stats_mv`** — company aggregation (replaces slow groupBy on 4.3M rows):
```sql
CREATE MATERIALIZED VIEW company_stats_mv AS
  SELECT company, COUNT(*) AS cnt
  FROM github_user
  WHERE company IS NOT NULL AND company <> ''
  GROUP BY company
  ORDER BY cnt DESC;

CREATE UNIQUE INDEX company_stats_mv_company_idx ON company_stats_mv (company);
```

**`country_language_stats_mv`** — language × country aggregation (powers Language Atlas `/devs/atlas`):
```sql
-- see scripts/create-country-language-mv.sql
-- or: pnpm create:country-language-mv:prod
```

**`user_repo_count_mv`** — per-user repo count (replaces expensive `LEFT JOIN star_event + COUNT(DISTINCT)` in nearby query, 6s → ~200ms):
```sql
-- pnpm create:user-repo-count-mv:prod
SET statement_timeout = 0;
CREATE MATERIALIZED VIEW user_repo_count_mv AS
  SELECT login, COUNT(*) AS repo_count FROM star_event GROUP BY login;
CREATE UNIQUE INDEX user_repo_count_mv_login_idx ON user_repo_count_mv (login);
```

**`trending_repos_mv`** — top repos by star velocity (powers `/trending` + `GET /api/trending`):
```sql
-- pnpm create:trending-mv:prod
-- see scripts/create-trending-mv.sql
-- Also creates star_event_starred_at_idx index on star_event("starredAt")
```

All 7 MVs are refreshed daily via `/api/admin/refresh-grid-mv` (Vercel Cron, 03:00 UTC). Routes using MVs fall back gracefully if a MV is missing (503 for trending, direct table scan for others).

### GIN Trigram Indexes — One-Time Setup Required

Required for `ILIKE '%search%'` on `login` and `name` (explore/top search). Without them: full seq scan on 4.3M rows (~6s). With them: ~50ms.

```sql
-- pnpm create:trgm-indexes:prod
SET statement_timeout = 0;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS github_user_login_trgm_idx ON github_user USING gin (login gin_trgm_ops);
CREATE INDEX IF NOT EXISTS github_user_name_trgm_idx  ON github_user USING gin (name  gin_trgm_ops);
```

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
| `JAWG_TOKEN_HEADER` | Recommended | Jawg dedicated token — main stargazer geocoding via `starmapper.jawg.io` (x-api-key header + access-token query param) |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg token for explore autocomplete + reverse geocoding (`api.jawg.io`) |
| `GEOAPIFY_APIKEY` | Recommended | Geoapify — geocoding fallback 1 |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for MapLibre tile style URL (primary) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2` | No | Jawg fallback token — auto-used when primary hits Map Views limit (401/402/403/429) |
| `NEXT_PUBLIC_APP_URL` | No | App URL for metadata |
| `SM_TOKEN_SECRET` | Recommended | HMAC secret for session token anti-scraping (min 32 chars). Generate: `openssl rand -hex 32`. When unset, falls back to Referer check only. |
| `UPSTASH_REDIS_REST_URL` | Recommended | Upstash Redis URL for distributed rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | Upstash Redis token |
| `CACHE_SIGN_SECRET` | Recommended | HMAC-SHA256 key used to sign PAT→login cache entries in Upstash (prevents forgery if Redis is compromised). Generate: `openssl rand -hex 32`. When unset, entries are stored unsigned. |

Without `JAWG_TOKEN_HEADER` and `GEOAPIFY_APIKEY`, all stargazer geocoding falls through to Nominatim — strictly sequential at 1100ms per call, noticeably slower for large repos.

**First-time DB setup:**
```bash
# After setting DATABASE_URL in .env.local
npx prisma db push
```

---

## VII. Development Commands

**pnpm vs Make — rationale**: Two toolchains coexist intentionally.
- **pnpm** — all scripts that need argument passthrough (`--force`, `--dry-run`, `--prod`). pnpm forwards extra args after `--` directly to the script. Scripts using Node `parseArgs` require a `[ "$1" = "--" ] && shift` guard in the wrapper to strip the separator pnpm injects.
- **make** — multi-step workflows with target dependencies (`db-pull: db-dump db-restore`) and shell-heavy ops (dump/restore, sync to Neon) where target chaining and shell variable interpolation are natural. Make cannot forward arbitrary args to sub-commands, so avoid it for scripts that take flags.

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

# DB Sync (additive upsert, table-by-table)
pnpm db:sync:to-prod                                      # local Docker → Neon prod  ⚠️ WRITES TO PROD
pnpm db:sync:from-prod                                    # Neon prod → local Docker (all tables)
pnpm db:sync:from-prod -- --repo facebook/react           # Neon prod → local, one repo only (~30s)
pnpm db:sync:from-prod -- --limit 100000                  # Neon prod → local, top 100k users by followers
pnpm db:sync:from-prod -- --tables badge_cache,stargazer_cache  # metadata only

# DB Dump/Restore (full dump — replaces local entirely)
pnpm db:dump                                              # dump Neon prod → /tmp/neon-prod.dump
pnpm db:restore                                           # restore /tmp/neon-prod.dump → local Docker
pnpm db:pull                                              # dump + restore in one step (prod → local)

# One-time DB setup (run once per DB instance — local + Neon prod)
pnpm create:trgm-indexes:prod       # GIN trigram indexes on login+name (ILIKE search, 6s→50ms)
pnpm create:user-repo-count-mv:prod # MV per-user repo count (nearby query, 6s→200ms)
pnpm create:trgm-indexes            # same for local Docker
pnpm create:user-repo-count-mv      # same for local Docker

# Geocache seeding
pnpm seed:geonames        # Seed geocache from GeoNames (idempotent)
pnpm seed:geonames:dry    # Dry-run — preview + stats, no insert

# Backfill — badge_cache (repo metadata)
pnpm backfill:repo-metrics -- --force          # stars, forks, watchers, release info (all repos)
pnpm backfill:repo-metrics -- --dry-run        # preview only
pnpm backfill:repo-metrics:prod -- --force     # same → Neon prod
pnpm backfill:repo-languages                   # primary language per repo
pnpm backfill:repo-languages:prod              # same → Neon prod
pnpm backfill:organic-score -- --force         # organic score + tier (repos ≥ 5000 stars)
pnpm backfill:organic-score:prod -- --force    # same → Neon prod

# Backfill — github_user (developer data)
pnpm backfill:languages -- --force             # languages[] from dev's own repos (GitHub GraphQL)
pnpm backfill:languages -- --from-cache        # pre-fill from star_event + badge_cache (no API)
pnpm backfill:languages:prod -- --force        # same → Neon prod
pnpm backfill:user-top-repos -- --force        # topRepos[] for devs with ≥ 100 followers
pnpm backfill:user-top-repos:prod -- --force   # same → Neon prod
pnpm backfill:linkedin -- --top 5000           # LinkedIn URLs via GitHub social accounts
pnpm backfill:linkedin:prod                    # same → Neon prod
pnpm backfill:locations                        # countryNormalized + cityNormalized (one-shot)

# Batch scan — rescan repos (delta by default, --force for full rescan)
# Generate input JSON from DB: psql $DATABASE_URL_LOCAL -t -A -c "SELECT json_agg(owner||'/'||repo) FROM badge_cache" > /tmp/all-repos.json
pnpm batch:scan -- --input /tmp/all-repos.json           # delta scan all repos (local)
pnpm batch:scan -- --input /tmp/all-repos.json --force   # full rescan (local)
pnpm batch:scan:prod -- --input /tmp/all-repos.json      # delta scan → Neon prod

# Maintenance pipeline (local backfills → sync to Neon → refresh MVs)
make maintenance          # full pipeline
make maintenance-dry      # dry-run, no writes, no sync
make maintenance-sync-only  # skip backfills, sync + refresh MVs only
bash scripts/maintenance.sh --skip-sync  # backfills only

# Analytics
pnpm stats:views                   # Global overview (last 7 days, top 20)
pnpm stats:views --user <login>    # Profile + all repos for a user
pnpm stats:views --slug <slug>     # Specific repo or profile
pnpm stats:views --days 30 --top 5 # Custom window + limit
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

**Constraints**: Hobby default 10s timeout (configurable to 60s, or 300s with Fluid Compute) → solved by chunk architecture. 4.5MB request body limit → solved by client-side gzip. Neon free: 512MB → monitored via `db-health.ts`.

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

*Last updated: 2026-04-24*
*Version: 0.4.1*


## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

### Workflow

1. Start with `grepai search` to find relevant code
2. Use `grepai trace` to understand function relationships
3. Use `Read` tool to examine files from results
4. Only use Grep for exact string searches if needed

