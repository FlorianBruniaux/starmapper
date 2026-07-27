# CLAUDE.md — StarMapper

**StarMapper** maps the stargazers of any GitHub repository on an interactive world map. Free, no auth required. Given a repo URL it fetches stargazers via GitHub GraphQL, geocodes their locations through a 3-tier cascade, and renders a MapLibre GL map with GeoJSON clustering.

**Tech Stack**: Next.js 16.2.11 (App Router, Turbopack) · TypeScript 5 · MapLibre GL 5.24.x · Prisma 7.8.0 + `@prisma/adapter-neon` · Neon Postgres · Jawg/Geoapify/Nominatim · Tailwind v4 · Vercel

---

## Architecture

The browser orchestrates a sequential chunk loop: `POST /api/chunk` (100 users per call) hits GitHub GraphQL, geocodes through the 3-tier cascade, and returns points that MapLibre renders progressively. No long-running server function needed — each chunk stays under Vercel's 10s limit.

Completed scans are cached in Neon (`stargazer_cache`) after gzip+base64 compression client-side. Raw JSON ~15MB compresses to ~800KB — necessary to stay under Vercel's 4.5MB request body limit.

Seven materialized views (not managed by Prisma) power `/trending`, `/devs/atlas`, explore search, and nearby queries. Run `pnpm db:setup` once on any fresh DB.

📖 Full architecture, file map, and endpoint reference: `docs/ARCHITECTURE.md`

---

## Rate Limits (CRITICAL)

| Service | Limit | Handling |
|---------|-------|----------|
| GitHub GraphQL | 5000 pts/hr (login+name+location ≈ 0.1 pts/user) | Headers checked, 429 → wait |
| Jawg dedicated (`starmapper.jawg.io`) | No strict limit, provisioned to absorb spikes | Circuit breaker: 3 errors → 1h cooldown |
| Jawg shared Places (`api.jawg.io`) | Places quota, billed separately from Map Views | Own circuit breaker + token fallback |
| Geoapify | 3,000 credits/day | Circuit breaker: 3 errors → 1h cooldown |
| Nominatim | 1 req/s (polite use policy) | 1100ms delay between calls |
| Vercel | 10s default, 60s configurable | Chunk architecture handles this |

Geocoding waterfall (4 tiers, `src/lib/geocoder.ts`): dedicated Jawg host → shared Jawg Places API → Geoapify → Nominatim. Each Jawg tier has its own token pool with automatic fallback to a secondary account on 401/402/403/429 (`src/lib/jawg-token.ts`). The two hosts authenticate differently: the dedicated one by `x-api-key` header, the shared one by `access-token` query param, which `api.jawg.io` alone accepts.

Without any Jawg or Geoapify key, all geocoding falls to Nominatim at 1100ms/call, very slow on large repos.

---

## Known Gotchas

- **Prisma 7 adapter**: `schema.prisma` has NO `url` field — connection string passed via adapter in `db.ts`. `DATABASE_DRIVER=neon` (Vercel) or `standard` (Docker/Railway).
- **MapLibre GL 5.x**: `getClusterExpansionZoom` returns a Promise, not a callback.
- **StargazerCache write**: always send `pointsGz`/`unmappedGz` (gzip+base64), never raw arrays.
- **Neon DDL**: never `CREATE INDEX CONCURRENTLY` (PANIC). Always prefix DDL with `SET statement_timeout = 0;`.
- **13 MVs + GIN indexes**: not managed by Prisma, run `pnpm db:setup` once per DB instance. `repo_power_users_mv` must be refreshed after `power_users_mv`, never before.
- **GitHub GraphQL cursor**: never pass `cursor: null` — omit or pass `undefined`.
- **AnnouncementBanner**: dismissal stored by `BANNER_ID` in localStorage — bump the string to force reappear for existing users.
- **DB Health Guard**: writes silently skip if Neon storage > 95% (`src/lib/user-cache.ts`). Intentional.
- **After `prisma db push`**: run `pnpm backfill:api-key-hash` to populate `keyHash` on existing `ApiKey` rows.

📖 Details and code examples: `.claude/rules/known-gotchas.md`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | PAT with `read:user` scope (without: 60 req/hr) |
| `JAWG_TOKEN_HEADER` | Recommended | Jawg dedicated token, main geocoding via `starmapper.jawg.io` (sent as `x-api-key` header) |
| `JAWG_TOKEN_HEADER_2` | No | Jawg geocoding fallback token, auto-used on 401/402/403/429 |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg Places token for explore autocomplete + reverse geocoding (sent as `access-token` query param) |
| `JAWGMAP_ACCESS_TOKEN_2` | No | Jawg Places fallback token, auto-used on 401/402/403/429 |
| `GEOAPIFY_APIKEY` | Recommended | Geoapify — geocoding fallback 1 |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for MapLibre tile style URL (primary) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2` | No | Jawg fallback token — auto-used on 401/402/403/429 |
| `SM_TOKEN_SECRET` | Recommended | HMAC secret, min 32 chars (`openssl rand -hex 32`) |
| `UPSTASH_REDIS_REST_URL` | Recommended | Upstash Redis for distributed rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | Upstash Redis token |
| `CACHE_SIGN_SECRET` | Recommended | HMAC-SHA256 for signing PAT→login entries in Upstash |

---

## Dev Commands

```bash
pnpm dev                         # Dev server (Turbopack)
pnpm build                       # Production build
rtk tsc                          # TypeScript check (token-efficient)
pnpm test                        # Run all tests
pnpm test:coverage               # Coverage report

npx prisma db push               # Sync schema to Neon (no migration files)
npx prisma generate              # Regenerate Prisma client after schema change

pnpm db:sync:from-prod           # Neon prod → local Docker
pnpm db:sync:to-prod             # local Docker → Neon prod  ⚠️ WRITES TO PROD
pnpm db:pull                     # Full dump + restore: prod → local

make maintenance                 # Interactive wizard: checkboxes per step, dry-run prompt, then calls maintenance.sh
pnpm stats:views                 # Analytics overview (last 7 days, top 20)

# ─── Indexing new repos ───────────────────────────────────────────────────────
make auto-index                  # Discover + scan 100 new trending repos → Neon prod (default)
make auto-index LIMIT=50 MIN_STARS=1000  # Custom params
make auto-index-dry              # Preview discovery only, no scan, no writes
make auto-index-local            # Same but targets local Docker (sync to Neon after)
make index-repo REPO=owner/repo  # Index a single specific repo
```

`pnpm` for scripts that need `--flag` passthrough. `make` for multi-step shell workflows with target dependencies.

📖 Full command list: `package.json` scripts + `Makefile`

---

## Git Conventions

**Branches**: `feature/*`, `fix/*`, `chore/*`

**Commit format**: `type(scope): imperative lowercase message` (max 50 chars)

| Scope | What it covers |
|-------|----------------|
| `map` | MapLibre component, clustering, popups |
| `api` | Route handlers |
| `badge` | BadgeCache, SVG badge endpoint |
| `cache` | StargazerCache, compression |
| `geocoder` | geocoder.ts, Jawg/Geoapify/Nominatim, geocache |
| `github` | github.ts, GraphQL/REST queries |
| `db` | schema.prisma, Prisma config, DDL scripts |
| `ui` | Landing page, map page, stats panel, drawer |
| `admin` | Admin-only endpoints |
| `mcp` | mcp/ package, MCP tools, /api/mcp/* routes |
| `config` | env, next.config, tsconfig |
| `deps` | package.json, pnpm-lock |

---

## Out of Scope

- Auth / user accounts (StarMapper is stateless read-only)
- Star history over time as a primary feature (that's star-history.com)
- Real-time updates / webhooks
- Full standalone stargazer profile pages (detail cards in map popups: fine; separate pages: no)
- Server-side rate limit queuing (client loop handles retries)
- Fuzzy matching on location strings (Nominatim handles it)

---

## Rules & References

| File | What's in it |
|------|--------------|
| `.claude/rules/known-gotchas.md` | Prisma adapter pattern, MapLibre 5.x, Neon DDL, MVs, cursor, banner |
| `.claude/rules/architecture.md` | Chunk loop contract, geocoder/github.ts signatures, API route conventions |
| `.claude/rules/code-conventions.md` | TypeScript style, import order, React/MapLibre patterns |
| `.claude/rules/design-system.md` | Tailwind v4 tokens, StarMapper palette, zero arbitrary values rule |
| `.claude/rules/tdd-mandatory.md` | Test-first rules, coverage targets (872 tests), vitest config |
| `.claude/rules/defensive-code-audit.md` | Silent catches, async forEach, Nominatim delay, null guards |
| `.claude/rules/search-strategy.md` | When to use grepai vs Grep vs Glob for code exploration |
| `docs/ARCHITECTURE.md` | Full system architecture, file map, all endpoint contracts |
| `docs/design-system.md` | Full token reference, light/dark palettes |
| `docs/organic-score.md` | Organic Score feature — signals, weights, calibration |

---

*Last updated: 2026-07-01*
*Version: 0.6.10*
