# StarMapper

<p align="center">
  <a href="https://starmapper.bruniaux.com"><img src="https://img.shields.io/badge/Live_Demo-starmapper.bruniaux.com-58a6ff?style=for-the-badge" alt="Live Demo"/></a>
  <a href="https://starmapper.bruniaux.com/FlorianBruniaux/starmapper"><img src="https://starmapper.bruniaux.com/api/badge/FlorianBruniaux/starmapper" alt="StarMapper badge"/></a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"/></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16.2-black?logo=next.js" alt="Next.js"/></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="https://maplibre.org"><img src="https://img.shields.io/badge/MapLibre_GL-5.x-396cb2" alt="MapLibre GL"/></a>
  <a href="https://neon.tech"><img src="https://img.shields.io/badge/Neon-Postgres-00e599?logo=postgresql&logoColor=white" alt="Neon"/></a>
</p>

> **See who stars your repo, on a map.**

Enter any GitHub repository URL and StarMapper fetches all stargazers, geocodes their locations, and renders an interactive world map with native clustering. Results load progressively as chunks arrive, so large repos (2000+ stars) work without timeout issues.

---

## What it does

- **Interactive world map** — MapLibre GL clustering, heatmap mode, animated timelapse, multi-repo compare, deep-link sharing with active filters
- **Stats panel** — countries, cities, companies, geo velocity (which countries are accelerating), power users (cross-repo stargazers), watch mode for launch days
- **Sharing & embeds** — SVG shield badge, scatter map image for READMEs (`<picture>` dark/light), PNG share card, public GeoJSON API
- **Developer profiles** — `/profile/[login]` with mini-map, nearby developers, top repos, news announcements with RSS/JSON feeds
- **Explore & discover** — developer leaderboard, trending repos map, Language Atlas (dominant language per country), Chrome Extension

Full feature list: [docs/FEATURES.md](docs/FEATURES.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Organic Score

StarMapper computes an **Organic Score** (0–100) estimating whether a star count reflects real usage or star farming. Three public signals:

| Signal | Weight | What it measures |
|---|---|---|
| Fork/Star ratio | 40% | Real developers fork repos they use |
| Watcher/Star ratio | 5% | Watchers are a deliberate opt-in since 2020 |
| Zero-follower stargazers | 55% | Star-farming services use newly-created accounts |

Scores map to: **Healthy** (75–100), **Moderate** (50–74), **Suspicious** (0–49). Full methodology: [docs/organic-score.md](docs/organic-score.md)

---

## How it works

Each `/api/chunk` call processes 100 stargazers and returns in under 10 seconds. The browser orchestrates the loop sequentially until all pages are fetched, then caches the full result so subsequent visitors load instantly.

Full architecture, request flow, and rate limit table: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

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

### 4. (Optional) Pre-seed the geocache

```bash
pnpm seed:geonames
```

Inserts ~51k GeoNames entries. Without this, first-time geocoding is slower since every location goes through the API cascade. The operation is idempotent.

### 5. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), enter any public GitHub repo URL.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon, Docker, Railway, Supabase…) |
| `DATABASE_DRIVER` | No | `neon` (default) or `standard` (plain TCP PostgreSQL) |
| `GITHUB_TOKEN` | Yes | GitHub PAT with `read:user` scope |
| `JAWG_TOKEN_HEADER` | Recommended | Dedicated Jawg Places geocoding token (`starmapper.jawg.io`) |
| `JAWGMAP_ACCESS_TOKEN` | Recommended | Jawg token for explore autocomplete + reverse geocoding |
| `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` | Yes (client) | Jawg token for MapLibre tile rendering |
| `GEOAPIFY_APIKEY` | Recommended | Geocoding fallback (Geoapify) |
| `NEXT_PUBLIC_APP_URL` | No | App base URL for OG metadata |
| `ADMIN_SECRET` | No | Secret for `/api/admin/*` routes |

Without `JAWG_TOKEN_HEADER` and `GEOAPIFY_APIKEY`, geocoding falls back to Nominatim (sequential, 1 req/s). With the GeoNames pre-seed in place, this rarely matters.

---

## Development

```bash
pnpm dev              # Dev server (Turbopack)
pnpm build            # Production build
pnpm typecheck        # tsc --noEmit
pnpm test             # Unit tests (Vitest)
npx prisma db push    # Apply schema changes
npx prisma generate   # Regenerate Prisma client
```

Full command reference including backfills, batch scan, and maintenance pipeline: [CLAUDE.md](CLAUDE.md) section VII.

---

<details>
<summary><strong>Privacy & Data</strong></summary>

### What data is collected

StarMapper accesses **publicly available data** from the GitHub API, the same data visible to anyone browsing github.com:

- GitHub username (login)
- Display name (if set on the profile)
- Self-declared location field (e.g. "Paris, France")
- Star date

No private data is ever accessed. No email addresses. No repository content or commit history.

### What we do with it

Location text is geocoded into coordinates and stored in a shared cache to avoid redundant API calls. Results appear as **geographic clusters on a map**, not as searchable individual records.

### What we don't do

- No ads, no analytics, no tracking
- No selling or sharing of data with any third party
- No user accounts, no email collection
- No monetisation of any kind

### Data retention

Geocoding cache entries and scan results are automatically purged after 12 months.

### Your rights

**Option 1 (immediate):** Remove or clear your location in your [GitHub profile settings](https://github.com/settings/profile). The next scan that includes you will use the updated profile.

**Option 2 (full deletion):** Email `florian@bruniaux.com` with subject "GDPR Data Deletion Request" and your GitHub username. Done within 30 days.

Full privacy policy: [starmapper.bruniaux.com/privacy](https://starmapper.bruniaux.com/privacy)

</details>

---

## Sponsors & Acknowledgments

StarMapper is made possible thanks to:

- **[JawgMaps](https://www.jawg.io)** — map tiles and a dedicated geocoding instance (`starmapper.jawg.io`)
- **[Neon](https://neon.tech)** — serverless Postgres hosting the geocache, scan results, and all user-level data

---

## Contributing

Open an issue before sending a pull request for anything beyond a typo fix. The project is intentionally minimal; `CLAUDE.md` section X lists what is explicitly out of scope.

By submitting a pull request, you certify that your contribution complies with the [Developer Certificate of Origin v1.1](https://developercertificate.org/). Add a `Signed-off-by` line to your commits (`git commit -s`).

---

## About the Author

**Florian Bruniaux**, developer and builder based in France. StarMapper started as a weekend experiment to visualize my own repo's audience, kept evolving, and ended up being useful to others too.

Other tools in the same ecosystem — most useful if you work with GitHub and Claude Code:

| Project | What it does |
|---------|-------------|
| [claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide) | 24K+ lines on Claude Code: architecture, security, TDD/BDD, 271 quiz questions, 655 malicious skills DB |
| [RTK](https://github.com/rtk-ai/rtk) | CLI proxy — 60-90% token reduction on git, tsc, vitest, prisma and more |
| [ccboard](https://github.com/FlorianBruniaux/ccboard) | Real-time TUI/Web dashboard for Claude Code monitoring |
| [cc-sessions](https://github.com/FlorianBruniaux/cc-sessions) | Fast CLI to search, browse and analyze Claude Code session history |
| [ctxharness](https://github.com/FlorianBruniaux/ctxharness) | Detects stale facts in CLAUDE.md, AGENTS.md, .cursorrules before they reach your agents |
| [dep-scope](https://github.com/FlorianBruniaux/node-dep-scope) | Symbol-level dependency analyzer for TypeScript/JS — shows what you actually use |
| [cc-copilot-bridge](https://github.com/FlorianBruniaux/cc-copilot-bridge) | Route Claude Code through GitHub Copilot Pro+ for flat-rate billing |
| [claude-cowork-guide](https://github.com/FlorianBruniaux/claude-cowork-guide) | Claude for non-coders: 28 business workflows, writers, ops managers, async teams |

GitHub: [github.com/FlorianBruniaux](https://github.com/FlorianBruniaux) · Email: florian@bruniaux.com

---

## License

[AGPL-3.0-only](./LICENSE), free to use, fork, and self-host. If you modify StarMapper and run it as a public service, you must publish your source changes under the same license.

This project is archived on [Software Heritage](https://www.softwareheritage.org) for provenance and authorship verification.
