# StarMapper

<p align="center">
  <a href="https://starmapper.bruniaux.com"><img src="https://img.shields.io/badge/Live_Demo-starmapper.bruniaux.com-58a6ff?style=for-the-badge" alt="Live Demo"/></a>
  <a href="https://chromewebstore.google.com/detail/starmapper/ejpbdhlaohhngpfbjjfadokgnndnnmmh"><img src="https://img.shields.io/badge/Chrome_Extension-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension"/></a>
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

Stars are a proxy for developer community. Where those developers live tells you where your project has traction, which markets are accelerating, and who your most influential users are.

Enter a GitHub repo URL and StarMapper maps every stargazer, identifies the influential ones, and tells you whether those numbers are organic.

---

## What it does

- **Map who follows your most influential stargazers**: every developer profile has a `/[owner]/followers` page with a full map of their GitHub followers, using the same geocoding and clustering as repo maps
- **Know your influential stargazers**: filter by follower count (500+, 1k+, 5k+), see who has reach in your audience, spot the developer with 20k followers who starred you last week
- **See which countries are discovering you**: geographic velocity compares the last 30 days against the prior window, four statuses per country: rising, new, stable, declining
- **Compare two audiences side by side**: overlay two repos on the same map, blue vs purple points, see instantly whether you share an audience or target different communities
- **Watch stars arrive during a launch**: live mode polls GitHub every 60 seconds and shows "+N stars, India, Germany" with a pulsing indicator, built for Product Hunt and HN days
- **Verify whether the count is real**: the Organic Score (0-100) flags suspicious patterns using fork/star ratios and zero-follower accounts, 85.7% accuracy on a calibrated corpus
- **Query audience data from Claude Code**: `starmapper-mcp` exposes all five data surfaces as MCP tools so you can ask "who are my most influential stargazers?" or "which countries are accelerating?" directly in your terminal

Full feature list: [docs/FEATURES.md](docs/FEATURES.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Who is this for?

**OSS maintainers** who want to understand their audience beyond a star count. Which countries are discovering your repo? Who are the most-followed developers in your stargazers list? Is the traffic from Japan a spike or a sustained trend?

**Influential developers** whose activity is a signal others follow. StarMapper builds a visible profile for your curation: your own map, nearby developers, and a way for maintainers to find and contact you.

**DevRel teams and content creators** who need geographic data for blog posts, slides, or reports. Language Atlas, Timelapse, and the GeoJSON API (`/api/geo/[owner]/[repo]`) provide the data directly.

**Investors doing due diligence** who use star counts as a signal. The Organic Score adds a quality layer to a number that is otherwise trivially gameable.

| Tool | What it answers |
|---|---|
| star-history | When did stars arrive? (growth curve over time) |
| ossinsight | Who contributed code? (commit and PR analytics) |
| **StarMapper** | **Where is the audience? Who are the influential ones? Which countries are accelerating? Are the stars real?** |

---

## Organic Score

Stars are used as a proxy for quality by developers evaluating libraries, investors doing due diligence, and the press writing "trending in open source" articles. Services sell stars in bulk to inflate that number. StarMapper computes an **Organic Score** (0–100) using three public signals:

| Signal | Weight | What it measures |
|---|---|---|
| Fork/Star ratio | 40% | Real developers fork repos they use |
| Watcher/Star ratio | 5% | Watchers are a deliberate opt-in since 2020 |
| Zero-follower stargazers | 55% | Star-farming services use newly-created accounts |

Scores map to: **Healthy** (75–100), **Moderate** (50–74), **Suspicious** (0–49). Full methodology: [docs/organic-score.md](docs/organic-score.md)

---

## Add to your README

**Badge** (shields-style, star count + countries, CDN-cached every 6 hours):

```markdown
[![StarMapper](https://starmapper.bruniaux.com/api/badge/owner/repo)](https://starmapper.bruniaux.com/owner/repo)
```

**Map image** (scatter map, dark/light themes via `<picture>`): the "Embed" button on the map page generates the full HTML snippet ready to paste.

Replace `owner/repo` with your repository.

---

## Claude Code

Install `starmapper-mcp` as an MCP server to query StarMapper data directly from your terminal:

```json
{ "mcpServers": { "starmapper": { "command": "npx", "args": ["starmapper-mcp"] } } }
```

Five tools are available: `get_repo_stats`, `get_organic_score`, `get_velocity`, `get_influential_stargazers`, and `index_repo`. The last one drives the full indexation loop from the MCP client, so you can keep a repo's data fresh without opening a browser.

Override the default endpoint with `STARMAPPER_BASE_URL` if you run a self-hosted instance. Full docs: [`mcp/README.md`](mcp/README.md)

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

User profile records and star event data are automatically deleted after **12 months** from last fetch. The geocoding cache (location text strings only — no personal identifiers, no logins) is retained indefinitely to avoid redundant API calls; it contains no data linkable to individual users. Full details: [starmapper.bruniaux.com/privacy](https://starmapper.bruniaux.com/privacy).

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
