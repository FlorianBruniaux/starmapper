# PROJECT_INDEX — StarMapper

Quick-navigation index for contributors and LLM agents. Every concept reachable in ≤2 hops from here.

> Machine-readable mirror: `llms.txt` (same content, plain list format).

---

## By Task

### "I want to add a new API route"

1. Read the architecture contract → [`CLAUDE.md §II`](CLAUDE.md) (request flow) + [`.claude/rules/architecture.md`](.claude/rules/architecture.md)
2. Look at an existing route for the pattern → `src/app/api/badge-update/route.ts` (simple POST) or `src/app/api/chunk/route.ts` (complex processing)
3. Export your response type for client use — convention in [`.claude/rules/code-conventions.md`](.claude/rules/code-conventions.md)
4. Add a test → [`.claude/rules/tdd-mandatory.md`](.claude/rules/tdd-mandatory.md)

### "I want to modify the geocoding logic"

1. Entry point → `src/lib/geocoder.ts` — `geocode()` + `geocodeBatch()`
2. Rate limit rules → [`CLAUDE.md §II Rate Limits`](CLAUDE.md) (Nominatim 1 req/s, circuit breakers)
3. Cache key convention → `location.toLowerCase().trim()` → `geocache` table
4. Tests → `src/lib/geocoder.test.ts`

### "I want to change the map rendering"

1. Component → `src/components/map/stargazer-map.tsx` (MapLibre GL, client-only)
2. Dynamic import wrapper → `src/components/map/stargazer-map-dynamic.tsx`
3. Style tokens → `src/app/globals.css` (`@theme inline`) + [`.claude/rules/design-system.md`](.claude/rules/design-system.md)
4. MapLibre 5.x gotchas (Promise-based cluster API) → [`CLAUDE.md §IV Known Gotchas`](CLAUDE.md)

### "I want to update the database schema"

1. Edit → `prisma/schema.prisma`
2. Apply → `npx prisma db push` then `npx prisma generate`
3. Prisma + Neon adapter rules → [`CLAUDE.md §IV Known Gotchas`](CLAUDE.md) (no `url` field, adapter pattern)
4. If adding materialized views → [`CLAUDE.md §IV Materialized Views`](CLAUDE.md) (one-time setup section)

### "I want to add a new component"

1. Design tokens → [`.claude/rules/design-system.md`](.claude/rules/design-system.md)
2. Tailwind standards (no arbitrary values) → [`.claude/rules/tailwind-standards.md`](.claude/rules/tailwind-standards.md)
3. React patterns (refs, memo, cleanup) → [`.claude/rules/react-ref-patterns.md`](.claude/rules/react-ref-patterns.md)
4. Implementation checklist → [`.claude/rules/implementation-checklist.md`](.claude/rules/implementation-checklist.md)

### "I want to fix a bug"

1. Start with the code, not a guess → [`.claude/rules/debugging-methodology.md`](.claude/rules/debugging-methodology.md)
2. Root cause first, fix after
3. Branch: `fix/short-description`

### "I want to write or update tests"

1. Framework → Vitest, collocated with source (`src/lib/geocoder.test.ts` pattern)
2. TDD workflow → [`.claude/rules/tdd-mandatory.md`](.claude/rules/tdd-mandatory.md)
3. Run: `pnpm test` or `rtk vitest run`
4. Coverage report: `pnpm test:coverage`

### "I want to understand the chunk loop"

1. Client orchestrator → `src/app/[owner]/[repo]/page.tsx` (chunk loop section)
2. Server handler → `src/app/api/chunk/route.ts`
3. Architecture rationale → [`CLAUDE.md §II Why Client-Side Chunk Loop`](CLAUDE.md)

### "I want to add a new environment variable"

1. Add to `.env.local` (local) + Vercel dashboard (prod)
2. Document in [`CLAUDE.md §VI Environment Variables`](CLAUDE.md)

### "I want to run the project locally"

```bash
cp .env.local.example .env.local   # fill DATABASE_URL + GITHUB_TOKEN
pnpm install
npx prisma db push
pnpm seed:geonames                 # optional, pre-seeds geocache (~51k entries)
pnpm dev                           # starts on localhost:3000 (Turbopack)
```

---

## By Role

### Backend developer

| Starting point | Why |
|---|---|
| [`CLAUDE.md §II`](CLAUDE.md) | Full request flow + rate limits + DB schemas |
| `src/lib/geocoder.ts` | Core geocoding logic (3-tier cascade) |
| `src/lib/github.ts` | GitHub GraphQL fetcher |
| `src/lib/db.ts` | Prisma singleton + Neon adapter |
| `src/app/api/chunk/route.ts` | The hot path — most logic lives here |
| [`.claude/rules/architecture.md`](.claude/rules/architecture.md) | Contract for all API routes + DB access |
| [`.claude/rules/defensive-code-audit.md`](.claude/rules/defensive-code-audit.md) | Error handling, async patterns, Nominatim rules |

### Frontend / UI developer

| Starting point | Why |
|---|---|
| `src/app/globals.css` | All CSS tokens (`@theme inline`) |
| `src/components/map/stargazer-map.tsx` | Main MapLibre component |
| `src/app/page.tsx` | Landing page |
| `src/app/[owner]/[repo]/page.tsx` | Map page (most complex UI) |
| [`.claude/rules/design-system.md`](.claude/rules/design-system.md) | Token usage, color palette |
| [`.claude/rules/tailwind-standards.md`](.claude/rules/tailwind-standards.md) | No arbitrary values rule |
| [`.claude/rules/react-ref-patterns.md`](.claude/rules/react-ref-patterns.md) | MapLibre + React ref patterns |

### DevOps / infrastructure

| Starting point | Why |
|---|---|
| `.github/workflows/ci.yml` | CI pipeline (typecheck → lint → test → Semgrep) |
| `.github/workflows/audit.yml` | Dependency audit (weekly + PR gate) |
| [`CLAUDE.md §IX Deployment`](CLAUDE.md) | Vercel constraints, DB sync commands |
| `scripts/db/db-sync-to-neon.sh` | Local → prod sync script |
| `prisma/schema.prisma` | DB schema (no migration history — `db push` model) |
| [`CLAUDE.md §IV Neon DDL Constraints`](CLAUDE.md) | `CONCURRENTLY` banned, statement timeout |

### Data / analytics

| Starting point | Why |
|---|---|
| [`CLAUDE.md §II Materialized Views`](CLAUDE.md) | 7 MVs, when they're refreshed |
| `src/app/api/stats/[owner]/[repo]/route.ts` | Stats aggregation logic |
| `src/app/api/trending/route.ts` | Trending repos endpoint |
| `src/app/api/devs/atlas/route.ts` | Language × country aggregation |
| `pnpm stats:views` | Page view analytics CLI |
| `docs/organic-score.md` | Organic score model + signals |
| `docs/organic-score-calibration.md` | Calibration data |

### Chrome Extension developer

| Starting point | Why |
|---|---|
| `extension/README.md` | Dev setup, build, zip |
| `extension/wxt.config.ts` | WXT manifest config + permissions |
| `extension/entrypoints/content.ts` | Button injection + MutationObserver + bfcache |
| `extension/entrypoints/background.ts` | Context menu (service worker) |
| `extension/entrypoints/popup/` | Toolbar popup (vanilla TS + HTML) |

### Documentation / OSS

| Starting point | Why |
|---|---|
| `README.md` | Public-facing intro |
| `CONTRIBUTING.md` | Contribution guide |
| `SECURITY.md` | Responsible disclosure |
| `docs/ARCHITECTURE.md` | Deep architecture doc (31K) |
| `docs/ROADMAP.md` | Feature backlog |
| [`CLAUDE.md`](CLAUDE.md) | AI-facing project spec (authoritative) |

---

## Top 10 for New Contributors

If you're new to the codebase, read these in order:

1. `README.md` — what StarMapper is and does (2min)
2. [`CLAUDE.md §I–III`](CLAUDE.md) — identity, architecture, file map (15min)
3. `src/app/api/chunk/route.ts` — the hot path (understand this, understand everything)
4. `src/lib/geocoder.ts` — geocoding cascade, cache logic
5. `prisma/schema.prisma` — all DB models
6. `src/app/[owner]/[repo]/page.tsx` — client orchestration (large file — search for "chunk loop")
7. `src/components/map/stargazer-map.tsx` — MapLibre rendering
8. [`.claude/rules/code-conventions.md`](.claude/rules/code-conventions.md) — house style
9. [`.claude/rules/tdd-mandatory.md`](.claude/rules/tdd-mandatory.md) — test requirements
10. `CONTRIBUTING.md` — how to submit a PR

---

## Key Symbols

Exported types used across the codebase:

| Symbol | File | Description |
|---|---|---|
| `StargazerPoint` | `src/app/api/chunk/route.ts` | Geocoded user point (lat/lng + metadata) |
| `UnmappedUser` | `src/app/api/chunk/route.ts` | User without geocodable location |
| `UserDetail` | `src/app/api/user-details/route.ts` | Full user profile (bio, followers, etc.) |
| `geocode()` | `src/lib/geocoder.ts` | Single-location geocoding |
| `geocodeBatch()` | `src/lib/geocoder.ts` | Batch geocoding with rate limiting |
| `fetchStargazersPage()` | `src/lib/github.ts` | GitHub GraphQL paginator |
| `prisma` | `src/lib/db.ts` | Prisma singleton |
| `LANGUAGE_COLORS` | `src/lib/language-colors.ts` | 24 languages → hex color |

---

## Architecture at a Glance

```
Browser → /api/repo-info (metadata)
        → /api/stargazer-cache (cache hit? skip loop)
        → loop: POST /api/chunk (100 users/call)
               → GitHub GraphQL → geocoder cascade → return points[]
        → MapLibre GL renders points progressively
        → POST /api/stargazer-cache (write gzip+base64)
        → POST /api/badge-update (persist stats)
```

Full flow: [`CLAUDE.md §II Request Flow`](CLAUDE.md)

---

## Out of Scope

Things StarMapper will not build:
- Auth / user accounts
- Star history over time (see star-history.com)
- Real-time updates / webhooks
- Server-side rate limit queuing

Full list: [`CLAUDE.md §X`](CLAUDE.md)
