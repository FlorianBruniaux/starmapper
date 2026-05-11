# StarMapper

<p align="center">
  <a href="https://starmapper.bruniaux.com"><img src="https://img.shields.io/badge/Live_Demo-starmapper.bruniaux.com-58a6ff?style=for-the-badge" alt="Live Demo"/></a>
  <a href="https://starmapper.bruniaux.com/florianbruniaux/starmapper"><img src="https://starmapper.bruniaux.com/api/badge/florianbruniaux/starmapper" alt="StarMapper badge"/></a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"/></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16.2-black?logo=next.js" alt="Next.js"/></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="https://maplibre.org"><img src="https://img.shields.io/badge/MapLibre_GL-5.x-396cb2" alt="MapLibre GL"/></a>
  <a href="https://neon.tech"><img src="https://img.shields.io/badge/Neon-Postgres-00e599?logo=postgresql&logoColor=white" alt="Neon"/></a>
</p>

> **See who stars your repo, on a map.**

Enter any GitHub repository URL and StarMapper fetches all stargazers, geocodes their locations, and renders an interactive world map with native clustering. Results load progressively as chunks arrive, so large repos (2000+ stars) work without any timeout issues.

---

<!-- Add a screenshot here once the UI is stable: docs/assets/screenshot.png -->

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Tech Stack](#tech-stack)
- [Development Commands](#development-commands)
- [Privacy & Data](#privacy--data)
- [Sponsors & Acknowledgments](#sponsors--acknowledgments)
- [Contributing](#contributing)
- [About the Author](#about-the-author)
- [License](#license)

---

## Features

### Map & Visualization

- Interactive world map with native GeoJSON clustering (MapLibre GL 5.x)
- Progressive loading — points appear on the map as chunks arrive
- **Heatmap mode** — toggle between dot clusters and density heatmap from the Dock
- **Animated timelapse** — replay weekly star accumulation with speed control (0.5×–4×)
- **Multi-repo compare** — overlay two repos on the same map to visualize audience overlap
- Stargazer detail cards on click (bio, followers, company)
- Dark / light mode toggle

### Stats & Analytics

- **Stats panel** — 6 summary cards (mapped, countries, cities, top company, followers, scan date), all computed client-side after a scan
- **Notable stargazers** — top-5 by followers shown as avatar chips above the tabs, visible immediately on stats modal open
- **Geographic velocity** ("📈 Rising" tab) — shows which countries are accelerating: compares 30-day rate vs 31–90-day historical rate, with `rising / new / stable / declining` labels
- **Star growth timeline** — weekly bar chart with hover tooltips, best week / avg / total summary
- **Watch mode** — polls GitHub every 60s during a launch; pulsing badge shows `+N ★ · India, Germany` in real time; auto-stops after 10 min idle
- **Power users** tab — cross-repo stargazers ranked by number of repos they've starred on StarMapper

### Sharing & Embeds

- **Deep link sharing** — Share modal encodes all active filters (country, city, company, followers, date, tier, view mode) into the URL; recipients see the exact same filtered view
- **README badge** — SVG shield (`/api/badge/[owner]/[repo]`) cached 6h at CDN, one-click Markdown copy
- **README map image** — full scatter map as SVG (`/api/map-image/[owner]/[repo]?theme=dark|light`), embeddable via `<picture>` for dark/light auto-switching
- **PNG share card** — export the map + stats as a PNG for LinkedIn or social media

### Data & Geocoding

- 3-tier geocoding cascade: Jawg (primary) → Geoapify (fallback) → Nominatim (ultimate fallback)
- Shared geocache pre-seeded with ~51k GeoNames entries — over 99% of real locations resolve without any external API call
- Full scan results cached per repo; subsequent visitors get an instant map with no re-scan

### Explore & Discovery

- **Explore page** (`/explore`) — leaderboard of top stargazers by followers and public repos, top companies, top locations, filterable by country and company with deep-linkable URL state
- **Trending map** (`/trending`) — aggregate map of trending GitHub repos × stargazer geography, refreshed daily
- **Public GeoJSON API** (`/api/geo/[owner]/[repo]`) — API-key authenticated, returns country + city aggregates (GDPR-safe, no individual coordinates)

### Developer Profiles

- Profile page (`/profile/[login]`) with mini-map, language badges, follower stats, nearby developers, and top repos grid
- **Map a repo** button opens a full repo picker: all public repos (up to 500), searchable by name/description, sortable by Stars or A–Z
- One-click Refresh updates the profile from GitHub (location, follower count, repos)
- Devs can publish short announcements on their profile (280 chars, GitHub PAT auth), with RSS 2.0 and JSON Feed 1.1 feeds (`/api/feed/[login]/rss`, `/api/feed/[login]/json`)

### Developer Maps

- **Language Atlas** (`/devs/atlas`) — choropleth map showing the dominant programming language per country, powered by a materialized view
- **Dev Maps by language** (`/devs/[language]`) — developer map filtered by programming language (24 languages supported)

### UX

- Community maps table on the landing page (sortable, paginated, with Organic Score badges)
- Optional GitHub token input to raise rate limits from 60 to 5000 req/hour
- Collapsible sidebar on mobile
- Versioned changelog at `/changelog`

---

## Organic Score

StarMapper computes an **Organic Score** (0-100) for any mapped repository — a heuristic that estimates whether a star count reflects real usage or was inflated through paid star-farming services.

The score is based on three public signals available through the GitHub API:

| Signal | Weight | What it measures |
|---|---|---|
| Fork/Star ratio | 40% | Organic repos accumulate forks as developers build on them |
| Watcher/Star ratio | 5% | GitHub watchers explicitly subscribe — a deliberate action since 2020 |
| Zero-follower stargazers | 55% | Star-farming services use newly-created accounts with no social graph |

Scores map to four tiers: **Healthy** (75-100), **Moderate** (50-74), **Suspicious** (0-49), and **Insufficient data**.

> **This is a heuristic, not a verdict.** A suspicious score doesn't prove fraud — it means the signals are anomalous. Repos with viral growth, niche communities, or structurally low fork rates can score lower despite being fully organic. Read the full methodology before drawing conclusions.

Full methodology, calibration data, limitations, and disclaimer: [`docs/organic-score.md`](docs/organic-score.md)

---

## How It Works

Vercel's free tier caps serverless functions at 10 seconds per request. A 2000-star repo needs ~20 sequential GitHub GraphQL calls, plus geocoding. Instead of one long server call, StarMapper has the **browser** orchestrate a loop of `POST /api/chunk` requests. Each chunk processes 100 stargazers and returns in under 10 seconds, and the browser renders incoming points as they arrive.

```
Browser                          /api/chunk (Server)
  |                                      |
  |--- POST { owner, repo } ------------>|
  |                                      |--- GitHub GraphQL (100 users)
  |                                      |--- 3-tier geocoding + cache lookup
  |<-- { points[], nextCursor, total } --|
  |                                      |
  |--- POST { ..., cursor } ------------>|   (repeat until nextCursor === null)
  |
  → MapLibre GL renders points as they arrive
  → POST /api/stargazer-cache (gzip + write full scan to DB)
```

This keeps every server function well under the timeout, while the geocache (pre-seeded with ~51k cities) ensures most locations resolve instantly without hitting any geocoding API.

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Quick Start

**Prerequisites**: Node.js 20+, pnpm, a Neon Postgres database, a GitHub personal access token.

### 1. Clone and install

```bash
git clone https://github.com/FlorianBruniaux/starmapper.git
cd starmapper
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your values (see [Environment Variables](#environment-variables) below).

### 3. Initialize the database

```bash
npx prisma db push
```

This creates all required tables on your Neon database. No migration files are generated; `db push` is the intended workflow for this project.

### 4. (Optional) Pre-seed the geocache

```bash
pnpm seed:geonames
```

Inserts ~51k GeoNames entries (cities with population > 15k + country names). Without this step, first-time geocoding is slower since every location goes through the API cascade. The operation is idempotent, safe to run multiple times.

### 5. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), enter any public GitHub repo URL, and the map loads.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon, Docker, Railway, Supabase…) |
| `DATABASE_DRIVER` | No | `neon` (default, for Vercel) or `standard` (plain TCP PostgreSQL) |
| `GITHUB_TOKEN` | Yes | GitHub PAT with `read:user` scope |
| `JAWG_TOKEN_HEADER` | Recommended | Token for the dedicated Jawg Places geocoding instance (`starmapper.jawg.io`). Requires a **new dedicated token** from the Jawg dashboard, not the default account token. |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg token for explore autocomplete + reverse geocoding (`api.jawg.io`) |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for client-side MapLibre tile URL (map rendering only) |
| `GEOAPIFY_APIKEY` | Recommended | Geocoding fallback when Jawg fails |
| `NEXT_PUBLIC_APP_URL` | No | App base URL, used for OG metadata and Nominatim User-Agent |
| `ADMIN_SECRET` | No | Secret header for `/api/admin/*` routes; if unset, admin routes return 401 |
| `DB_STORAGE_LIMIT_MB` | No | DB storage cap in MB for health guard (default: 512, Neon Launch plan: 10240) |

**Without `JAWG_TOKEN_HEADER` and `GEOAPIFY_APIKEY`**, geocoding falls back to Nominatim only, rate-limited to 1 request/second. With the GeoNames pre-seed in place, this rarely matters since most locations are already cached.

**Without `GITHUB_TOKEN`**, GitHub's unauthenticated rate limit applies (60 req/hour), which blocks any repo with more than ~6000 stars.

> **Note on Jawg geocoding**: Batch geocoding is not permitted on the standard Jawg API. `JAWG_TOKEN_HEADER` targets a dedicated Jawg Places instance (`starmapper.jawg.io`) provided by JawgMaps specifically for StarMapper. It is separate from the map tile token and scoped to geocoding only. Requests include both an `x-api-key` header and an `access-token` query param (the query param is used for JawgMaps internal usage tracking).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map | MapLibre GL 5.x |
| Database | Neon Postgres via Prisma 7.5 + `@prisma/adapter-neon` |
| Geocoding | Jawg Places, Geoapify, Nominatim (cascaded) |
| Styling | Tailwind CSS v4 (`@theme inline`) |
| Deployment | Vercel (free tier compatible) |

---

## Development Commands

> **pnpm vs Make** — Two toolchains coexist intentionally. `pnpm` handles all scripts that need argument passthrough (`--force`, `--dry-run`, `--prod`, etc.) because Make cannot forward arbitrary arguments to sub-commands natively. `make` is kept for multi-step workflows with target dependencies (`db-pull: db-dump db-restore`) and shell-heavy operations (DB dump/restore, sync to Neon) where chaining and variable interpolation are more natural. Rule of thumb: if a command takes flags → `pnpm`. If it orchestrates multiple steps → `make`.

```bash
pnpm dev                  # Dev server with Turbopack
pnpm build                # Production build
pnpm typecheck            # tsc --noEmit

pnpm test                 # Run unit tests (vitest)
pnpm test:watch           # Watch mode
pnpm test:coverage        # Coverage report

npx prisma db push        # Apply schema changes to Neon
npx prisma studio         # GUI to browse tables
npx prisma generate       # Regenerate Prisma client after schema edits

# Geocache seeding
pnpm seed:geonames:dry    # Preview, no insert
pnpm seed:geonames        # Insert ~51k GeoNames entries (idempotent)

# Backfill — repo metadata (badge_cache)
pnpm backfill:repo-metrics -- --force    # Update stars, forks, watchers, release info (all repos)
pnpm backfill:repo-languages             # Update primary language per repo
pnpm backfill:organic-score -- --force   # Recompute organic scores (repos ≥ 5000 stars)

# Backfill — developer data (github_user)
pnpm backfill:languages -- --from-cache  # Fill languages[] from existing cache (no API calls)
pnpm backfill:languages -- --force       # Refetch languages via GitHub GraphQL API
pnpm backfill:user-top-repos -- --force  # Fetch top repos for devs (followers ≥ 100)
pnpm backfill:linkedin                   # Fetch LinkedIn URLs via GitHub social accounts
pnpm backfill:locations                  # Derive countryNormalized + cityNormalized

# Batch scan (delta by default — only new stars since last scan)
pnpm batch:scan -- --input /tmp/repos.json          # Delta scan from a repo list
pnpm batch:scan -- --input /tmp/repos.json --force  # Full rescan

# Maintenance pipeline (backfills → sync to Neon prod → refresh materialized views)
make maintenance          # Full pipeline
make maintenance-dry      # Dry-run preview, no writes
make maintenance-sync-only  # Sync + MV refresh only (skip backfills)
```

---

## Privacy & Data

<details>
<summary><strong>What data is collected, what we do with it, and your rights</strong></summary>

### What data is collected

StarMapper accesses **publicly available data** from the GitHub API, the same data visible to anyone browsing github.com:

- GitHub username (login)
- Display name (if set on the profile)
- Self-declared location field (e.g. "Paris, France")
- Star date

No private data is ever accessed. No email addresses. No repository content or commit history.

### What we do with it

Location text is geocoded into coordinates (via Jawg → Geoapify → Nominatim) and stored in a shared cache to avoid redundant API calls. Results appear as **geographic clusters on a map**, not as searchable individual records.

### What we don't do

- No ads, no analytics, no tracking
- No selling or sharing of data with any third party for commercial purposes
- No user accounts, no email collection
- No monetisation of any kind (this is a free, non-commercial side project)

### Data retention

StarMapper runs on a Neon free-tier Postgres database (512 MB). Geocoding cache entries and scan results are automatically purged after 12 months.

### Your rights

**Option 1 (immediate):** Remove or clear your location in your [GitHub profile settings](https://github.com/settings/profile). The next scan that includes you will use the updated profile.

**Option 2 (full deletion):** Email `florian@bruniaux.com` with the subject "GDPR Data Deletion Request" and your GitHub username. Done within 30 days.

Full privacy policy: [starmapper.bruniaux.com/privacy](https://starmapper.bruniaux.com/privacy)

</details>

---

## Sponsors & Acknowledgments

StarMapper is made possible thanks to the generous support of:

- **[JawgMaps](https://www.jawg.io)** for map tiles and a dedicated geocoding instance (`starmapper.jawg.io`) powering the primary location resolution
- **[Neon](https://neon.tech)** for serverless Postgres hosting the geocache, scan results, and all user-level data

---

## Contributing

Open an issue before sending a pull request for anything beyond a typo fix. The project is intentionally minimal; `CLAUDE.md` section X lists what is explicitly out of scope.

By submitting a pull request, you certify that your contribution complies with the [Developer Certificate of Origin v1.1](https://developercertificate.org/). Add a `Signed-off-by` line to your commits (`git commit -s`).

---

## About the Author

**Florian Bruniaux**, developer and builder based in France. Heavy Claude Code user.

I build open-source dev tools and share what actually works from my own practice. StarMapper started as a weekend experiment to visualize my own repo's audience, kept evolving, and ended up being useful to others too.

Other projects you might find useful:

| Project | What it is |
|---|---|
| [claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide) | 24K+ lines covering Claude Code: architecture, security (24 CVEs tracked), TDD/SDD/BDD workflows, 271 quiz questions, 228 templates |
| [claude-cowork-guide](https://github.com/FlorianBruniaux/claude-cowork-guide) | Claude for non-coders: writers, ops managers, people who want async workflows without writing code |
| [cc-copilot-bridge](https://github.com/FlorianBruniaux/cc-copilot-bridge) | Route Claude Code through GitHub Copilot Pro+ for flat-rate billing ($10/month instead of per-token) |

GitHub: [github.com/FlorianBruniaux](https://github.com/FlorianBruniaux) · Email: florian@bruniaux.com

---

## License

[AGPL-3.0-only](./LICENSE), free to use, fork, and self-host. If you modify StarMapper and run it as a public service, you must publish your source changes under the same license.

To report a license violation: florian@bruniaux.com

This project is archived on [Software Heritage](https://www.softwareheritage.org) for provenance and authorship verification.
