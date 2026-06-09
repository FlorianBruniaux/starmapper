# StarMapper — Product Reference

**Version**: 0.6.2 | **Last updated**: 2026-06-09

Free, open-source developer intelligence platform built around GitHub stargazer geography. No account required.

→ https://starmapper.bruniaux.com

---

## What it does

Paste a GitHub repo URL and get an interactive world map of every stargazer, geocoded in real time. Beyond the map: stats by country/city/company, velocity trends, developer profiles, language distribution across 180+ countries, a live watch mode for launch days, and a Chrome Extension that injects a Map button on every GitHub page.

The core insight: stars are a proxy for developer community. Where those developers live tells you where your project has traction, which markets are accelerating, and who your most influential users are.

---

## Live pages

| URL | What it is |
|-----|-----------|
| https://starmapper.bruniaux.com | Landing — repo URL input + community maps |
| https://starmapper.bruniaux.com/torvalds/linux | Map of linux's stargazers |
| https://starmapper.bruniaux.com/explore | Developer leaderboard + cross-repo analytics |
| https://starmapper.bruniaux.com/profile/florianbruniaux | My developer profile |
| https://starmapper.bruniaux.com/profile/ruvnet | ruvnet's profile (174 repos, 50k+ stars) |
| https://starmapper.bruniaux.com/devs | Developer maps filtered by language |
| https://starmapper.bruniaux.com/devs/atlas | Language Atlas — dominant language per country |
| https://starmapper.bruniaux.com/trending | Trending repos × stargazer geography |
| https://starmapper.bruniaux.com/torvalds/followers | Map of torvalds's GitHub followers |
| https://starmapper.bruniaux.com/feed/florianbruniaux | RSS subscription page |
| https://starmapper.bruniaux.com/faq | Frequently asked questions |
| https://starmapper.bruniaux.com/changelog | Version history |

---

## Features by surface

### Repo Map

The core. Given a GitHub repo, StarMapper fetches all stargazers via the GitHub GraphQL API, geocodes their self-declared locations through a 3-tier cascade (Jawg → Geoapify → Nominatim), and renders a MapLibre GL map with native GeoJSON clustering.

- **Progressive loading** — points appear as each batch of 100 users is geocoded. No waiting for the full scan.
- **Heatmap mode** — toggle between scatter dots and heat density. One button in the dock.
- **Multi-repo compare** — overlay two repos on the same map. Points from repo A are blue, repo B are purple. Shows audience overlap at a glance.
- **Animated timelapse** — weekly buckets replay on the map at 0.5×→4× speed. Based on `starredAt` timestamps already in DB.
- **Filters** — country, city, company, follower count, date range, tier. All combinable.
- **Deep link sharing** — the Share modal encodes all active filters into a URL. Opening it restores the exact view with a dismissible "Shared view" pill.
- **Star growth timeline** — "Growth" button in the Dock opens a bar chart of weekly star accumulation. Shows the shape of growth (steady climb, viral spike, plateau) as a complement to the `+N/mo` velocity indicator. Data from `starredAt` already in DB; falls back to in-memory scan data for recent, uncached repos.
- **Watch mode** — during a product launch, polls GitHub every 60s and shows `+N ★ · India, Germany` with a pulsing badge. Auto-stops after 10 min of inactivity. No DB writes, cache-free.
- **Shared cache** — first scan is cached globally. Any subsequent visitor loads the same repo instantly, no re-scan.

### Followers Map `/[owner]/followers`

Every GitHub user indexed in StarMapper has a followers map. The page geocodes all their GitHub followers through the same 3-tier cascade (Jawg, Geoapify, Nominatim) used for repo stargazers.

- **Full-screen map with clustering**: GeoJSON cluster layer, same rendering as repo maps. Points appear progressively as each batch of 100 followers is geocoded.
- **FollowersPanel side panel**: list of followers sorted by influence (follower count), with avatar, name, location, and follower badge. Virtual scroll handles large lists. Click a follower to fly the map to their location.
- **Summary badge**: mapped count and total, updated in real time during the scan.
- **Entry points on profile pages**: the followers count badge on `/profile/[login]` links to the followers map. A "Map followers" button appears in the profile actions row.

### Stats panel

Opened from the map page after a scan.

- **Summary cards** — total stargazers, geocoded %, countries, cities, companies, top followers
- **Notable stargazers** — top-5 by followers as avatar chips, visible immediately on open without switching tabs
- **Top Stars tab** — full leaderboard sortable by followers or public repos, with company badges
- **Geographic velocity** ("📈 Rising") — compares the 30-day daily rate vs the 31–90-day historical rate per country. Four statuses: `rising` (×1.5+), `new`, `stable`, `declining`. Answers "which countries are discovering this repo right now?"
- **Power tab** — cross-repo stargazers: users who starred more than one indexed repo. Identifies your most engaged community members.

### Developer profiles `/profile/[login]`

Every GitHub username has a StarMapper profile. Two-column layout: scrollable panel with data on the left, sticky mini-map on the right.

- **Profile card** — bio, followers, location, languages, top repos grid (up to 8)
- **Map a repo** — full repo picker (up to 500 repos, searchable, sortable by stars or A–Z). One click navigates to the StarMapper map for that repo.
- **Nearby developers** — list + pins on the map for geolocated devs within X km
- **Contact dropdown** — GitHub, LinkedIn, email, all obfuscated against scraping. Fetched on demand.
- **News & Announcements** — devs can publish short posts (280 chars, optional link) authenticated via GitHub PAT. Each profile gets RSS 2.0 and JSON Feed 1.1 feeds (1h CDN cache, `If-Modified-Since` supported).
- **Refresh** — re-fetches location, followers, and repos from GitHub with a 1h cooldown.
- **Auto-fetch on 404** — if a profile isn't in DB yet, it's fetched from GitHub on the first visit automatically.

### Explore `/explore`

Four tabs, sticky map that updates in sync with results.

- **Top** — leaderboard of stargazers ranked by followers. Filterable by country and company. Searchable by `@username` or `username`.
- **Power users** — developers who've starred the most indexed repos. Cross-repo engagement signal.
- **Nearby** — geolocated developers within a bounding box (set by clicking the map). Shows who your community is concentrated around any location.
- **Companies** — which companies appear most in developer profiles across all indexed repos.

### Dev Maps `/devs` and Language Atlas `/devs/atlas`

- **Dev Maps** — interactive map of developers filtered by programming language. Combobox to switch language, map updates in place. Based on `languages[]` field populated from each dev's own public repos.
- **Language Atlas** (`/devs/atlas`) — world choropleth showing the dominant language per country. Click a country for breakdown: dominant language, percentage, number of devs. Based on `country_language_stats_mv`, a materialized view refreshed daily.

### Chrome Extension (v1.1.0, Manifest V3)

Two injection points depending on the GitHub page:

- **Repo pages** (`github.com/owner/repo`) — "★ Map" button in the repo action bar. Toolbar popup: current repo + last 5 visited + search field. Right-click context menu on any GitHub repo link.
- **Profile pages** (`github.com/login`) — "★ StarMapper" button in the user sidebar, linking to `starmapper.bruniaux.com/profile/[login]`.

Handles GitHub SPA navigation (Turbo + bfcache). Adapts to dark/light theme via GitHub CSS variables.

### Integrations & embeds

- **SVG shield badge** (`/api/badge/[owner]/[repo]`): star count + countries mapped. 6h CDN cache. Copy Markdown in one click from the map page.
- **Map image embed** (`/api/map-image/[owner]/[repo]?theme=dark|light`): full 800×400 SVG scatter map. Use `<picture>` to serve dark/light variants. Embeddable in any README.
- **Public GeoJSON API** (`GET /api/geo/[owner]/[repo]`): aggregate countries + cities (top 50 each), API key authenticated, rate-limited 60 req/min. GDPR-safe (no individual coordinates). For third-party tools and dashboards.
- **RSS 2.0 + JSON Feed 1.1**: per-developer announcement feeds. Subscribable from any RSS reader.
- **Organic Score** (`GET /api/organic-score/[owner]/[repo]`): 0–100 score estimating whether stars are organic or farmed. Three signals: fork/star ratio (40%), watcher/star ratio (5%), zero-follower stargazers (55%). 85.7% accuracy on calibration corpus. Displayed on the repos landing page with a detail modal.

---

## Stack

Next.js 16.2.6 (App Router, Turbopack) + TypeScript 5 + MapLibre GL 5 + Prisma 7 + Neon Postgres (100GB, sponsored) + Jawg Maps (geocoding + tiles), deployed on Vercel.

GitHub GraphQL + REST for stargazer data. Upstash Redis for distributed rate limiting and PAT verification cache.
