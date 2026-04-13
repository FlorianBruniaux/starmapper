# StarMapper

[![StarMapper](https://starmapper.bruniaux.com/api/badge/florianbruniaux/starmapper)](https://starmapper.bruniaux.com/florianbruniaux/starmapper)

See who stars your repo, on a map.

Enter any GitHub repository URL and StarMapper fetches all stargazers, geocodes their locations, and renders an interactive world map with native clustering. Results load progressively as chunks arrive, so large repos (2000+ stars) work without any timeout issues.

<!-- screenshot -->

## Features

- Interactive world map with GeoJSON clustering (MapLibre GL)
- Progressive loading via client-side chunk loop — no serverless timeout limit
- 3-level geocoding cascade: Jawg (primary), Geoapify (fallback), Nominatim (ultimate fallback)
- Geocache pre-seeded with ~51k GeoNames entries — >99% of locations resolve without any API call
- **Language Atlas** — choropleth map showing the most popular language per country (`/devs/atlas`)
- **Dev Maps by language** — filter the developer map by programming language (`/devs/[language]`)
- Community maps table on the landing page (sortable, paginated)
- Dark / light mode toggle
- Embeddable SVG badge showing mapped count and country stats
- Optional GitHub token input for higher rate limits
- Stargazer detail cards (bio, followers, company) on click
- Collapsible sidebar on mobile

## Quick Start

**Prerequisites**: Node.js 20+, pnpm, a Neon Postgres database, a GitHub personal access token.

### 1. Clone and install

```bash
git clone https://github.com/your-username/starmapper.git
cd starmapper
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Then fill in your values in `.env.local`. See [Environment Variables](#environment-variables) for descriptions of each.

### 3. Initialize the database

```bash
npx prisma db push
```

This creates the `geocache` and `badge_cache` tables on your Neon database. No migration files are generated — `db push` is the intended workflow.

### 4. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), enter any public GitHub repo URL, and the map loads.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon, Docker, Railway, Supabase…) |
| `DATABASE_DRIVER` | No | `neon` (default, Vercel) or `standard` (plain PostgreSQL) |
| `GITHUB_TOKEN` | Yes | GitHub PAT with `read:user` scope |
| `JAWG_TOKEN_HEADER` | Recommended | Main stargazer geocoding token — dedicated Jawg Places instance (`starmapper.jawg.io`, provided by JawgMaps). Create a **new dedicated token** from the Jawg dashboard (not the default one). Sent as `x-api-key` header + `access-token` query param for usage stats — see note below. |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg token for explore page autocomplete + reverse geocoding (`api.jawg.io`) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for client-side MapLibre tile URL (map rendering only) |
| `GEOAPIFY_APIKEY` | Recommended | Geocoding fallback when Jawg fails |
| `NEXT_PUBLIC_APP_URL` | No | App base URL, used for OG metadata and Nominatim User-Agent |
| `ADMIN_SECRET` | No | Secret header for `/api/admin/*` routes — if unset, admin routes return 401 |
| `DB_STORAGE_LIMIT_MB` | No | DB storage cap in MB for health guard (default: 512, Neon Launch: 10240) |

Without `JAWG_TOKEN_HEADER` and `GEOAPIFY_APIKEY`, stargazer geocoding falls back to Nominatim only — rate-limited to 1 req/s. Thanks to GeoNames pre-seeding, this matters far less in practice (most locations already cached).

> **Note on Jawg geocoding**: Batch geocoding is not permitted on the standard Jawg API. `JAWG_TOKEN_HEADER` targets a dedicated Jawg Places instance (`starmapper.jawg.io`) provided by JawgMaps specifically for StarMapper — requests include both an `x-api-key` header and an `access-token` query param (the query param is used for JawgMaps usage stats; the token must be a new dedicated one, not the default account token). It is separate from the map tile token and scoped to geocoding only.

Without `GITHUB_TOKEN`, GitHub's unauthenticated rate limit applies (60 requests/hour), which will block any repo above roughly 6000 stars.

## Architecture

Vercel's free tier caps serverless functions at 10 seconds. Rather than running one long server call, StarMapper has the browser orchestrate a loop of `POST /api/chunk` requests, each processing 100 stargazers and returning in well under 10 seconds. The browser accumulates points progressively and renders them on the map as they arrive.

Full architecture documentation: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map | MapLibre GL 5.x |
| Database | Neon Postgres via Prisma 7.5 + `@prisma/adapter-neon` |
| Geocoding | Jawg, Geoapify, Nominatim |
| Styling | Tailwind CSS v4 (`@theme inline`) |
| Deployment | Vercel (free tier compatible) |

## Development Commands

```bash
pnpm dev                  # Dev server with Turbopack
pnpm build                # Production build
pnpm typecheck            # tsc --noEmit
pnpm test                 # Run unit tests (vitest)
pnpm test:watch           # Watch mode
pnpm test:coverage        # Coverage report

npx prisma db push        # Apply schema changes to Neon
npx prisma studio         # GUI to browse geocache and badge_cache
npx prisma generate       # Regenerate Prisma client after schema edits

# Geocache seeding (one-shot, idempotent)
pnpm seed:geonames:dry    # Preview keys that would be inserted
pnpm seed:geonames        # Insert ~51k GeoNames entries into geocache

# Language backfill (Language Atlas data)
pnpm backfill:languages --from-cache   # Pre-fill from star_event + badge_cache (no API)
pnpm backfill:languages --token-index 0  # Fill remaining via GitHub API (parallelizable)

# DB sync (local Docker → Neon prod)
pnpm db:sync              # Push github_user, star_event, badge_cache, stargazer_cache + refresh MVs
```

## Privacy & Data

### What data is collected

StarMapper accesses **publicly available data** from the GitHub API — the same data visible to anyone browsing github.com:

- GitHub username (login)
- Display name (if set on the profile)
- Self-declared location field (e.g. "Paris, France")
- Star date

No private data is ever accessed. No email addresses. No repository data beyond the public stargazer list.

### What we do with it

Location text is geocoded into coordinates (via Jawg → Geoapify → Nominatim) and stored in a shared cache to avoid redundant API calls. Results appear as **geographic clusters on a map** — not as searchable individual records.

### What we don't do

- No ads, no analytics, no tracking
- No selling or sharing of data with any third party for commercial purposes
- No user accounts, no email collection
- No monetisation of any kind — this is a free, non-commercial side project

### This project makes no money

StarMapper is a free, open-source tool built by one developer. No revenue, no investors, no sponsorship. The geocoding cache and scan results are stored on a Neon free-tier Postgres database (512 MB). Data is automatically purged after 12 months.

### Your rights

If you want your profile data removed:

**Option 1 (immediate):** Remove or clear your location in your [GitHub profile settings](https://github.com/settings/profile). The next scan that includes you will use your updated profile.

**Option 2 (full deletion):** Email `florian@bruniaux.com` with the subject "GDPR Data Deletion Request" and your GitHub username. Done within 30 days.

Full privacy policy: [starmapper.bruniaux.com/privacy](https://starmapper.bruniaux.com/privacy)

---

## Contributing

Open an issue before sending a pull request for anything beyond a typo fix. The project is intentionally minimal — see `CLAUDE.md` section X for what is explicitly out of scope.

By submitting a pull request, you certify that your contribution complies with the [Developer Certificate of Origin v1.1](https://developercertificate.org/). Add a `Signed-off-by` line to your commits (`git commit -s`).

## License

[AGPL-3.0-only](./LICENSE) — free to use, fork, and self-host. If you modify StarMapper™ and run it as a public service, you must publish your source changes under the same license.

To report a license violation: florian@bruniaux.com

This project is archived on [Software Heritage](https://www.softwareheritage.org) for provenance and authorship verification.
