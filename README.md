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

Copy the example below into `.env.local` at the project root and fill in your values:

```bash
# Required
DATABASE_URL=postgresql://...          # Neon connection string
GITHUB_TOKEN=ghp_...                   # PAT with read:user scope

# Map tiles + geocoding (primary)
JAWGMAP_ACCESS_TOKEN=...               # Jawg access token (server-side)
NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN=...   # Jawg access token (client-side map tiles)

# Geocoding fallback
GEOAPIFY_APIKEY=...                    # Geoapify API key

# Optional
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

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
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `GITHUB_TOKEN` | Yes | GitHub PAT with `read:user` scope |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Geocoding primary provider + server-side tile requests |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for client-side MapLibre tile URL |
| `GEOAPIFY_APIKEY` | Recommended | Geocoding fallback when Jawg fails |
| `NEXT_PUBLIC_APP_URL` | No | App base URL, used for OG metadata |

Without `JAWGMAP_ACCESS_TOKEN` and `GEOAPIFY_APIKEY`, geocoding falls back to Nominatim only — rate-limited to 1 req/s. Thanks to the GeoNames pre-seeding, this matters far less in practice (most locations already cached).

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

npx prisma db push        # Apply schema changes to Neon
npx prisma studio         # GUI to browse geocache and badge_cache
npx prisma generate       # Regenerate Prisma client after schema edits

# Geocache seeding (one-shot, idempotent)
pnpm seed:geonames:dry    # Preview keys that would be inserted
pnpm seed:geonames        # Insert ~51k GeoNames entries into geocache
```

## Contributing

Open an issue before sending a pull request for anything beyond a typo fix. The project is intentionally minimal — see `CLAUDE.md` section X for what is explicitly out of scope.

## License

MIT
