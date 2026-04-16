# StarMapper Roadmap

*Last updated: 2026-04-16 — v0.3.4*

---

## Done

- **Badge README** — `/api/badge/[owner]/[repo]` SVG shield, 6h CDN cache. Sidebar button + Share modal with live preview and copy Markdown.
- **Repo bookmarks** — localStorage, recent repos list on the landing page.
- **Share card** — PNG export of the map + stats, LinkedIn sharing with pre-filled text.
- **Client-side cache compression** — Web CompressionStream (gzip+base64) before `POST /api/stargazer-cache`. Fixes timeouts on 50k+ star repos.
- **Geocache pre-seeding** — ~51k GeoNames entries, >99% hit rate on real scans.
- **Stats panel** — 6 summary cards, company badges on Top Stars, sort toggle, Power tab (cross-repo stargazers via `star_event` group by).
- **Language Atlas** — `/devs/atlas`, choropleth map showing the dominant language per country. Based on starred and contributed repos. Early preview bandeau while backfill is running.
- **Dev Maps by language** — `/devs` + `/devs/[language]`, developer map filtered by programming language.
- **Explore page** — `/explore` leaderboard: top stargazers by followers and public repos, top companies, top locations, filterable by country and company. Cross-repo funnel.
- **Heatmap mode** — toggle dots vs heat density on the map. Implemented as a native MapLibre `heatmap` layer (`stargazer-map.tsx:100-113`), toggled from the dock.
- **Multi-repo compare** — overlay two repos on the same map to see audience overlap. Browser orchestrates a parallel chunk scan for the second repo (`page.tsx:602-638`), rendered as a distinct color layer.
- **Animated timelapse** — weekly buckets replay on the map, speed selector (0.5×→4×). Data source: `starredAt` from `star_event`. Controls in the dock.
- **Public GeoJSON API** — `GET /api/geo/[owner]/[repo]` with API key auth. Aggregate countries + cities only (RGPD-safe). Rate-limited via Upstash. Keys provisioned manually via `scripts/generate-api-key.ts`.
- **Profile page `/profile/[login]`** — Combined v1+v2. Profile card (avatar, name, company, location, followers, language pills), 2/3 content + 1/3 map split layout. Reverse lookup: starred repos on StarMapper ordered by recency. Owned repos grid. Developers nearby with pin-on-map. Partial profile fallback for repo owners not tracked as stargazers. All `@login` links across the app (map popup, Explore, Stats panel) point to profile pages. "Wrong location?" now works for all users.

---

## Quick wins (1-2h each)

---

## Medium term

- **Watch mode** — poll every few minutes during a launch, display "+3 new stars in Paris" with a pulsing badge. Useful during launches and spikes.

- **Jawg Places JS integration** — replace the `/api/explore/autocomplete` + `/api/explore/geocode` proxy routes with the official Jawg Places JS client-side library. Instant suggestions without a round-trip, less server code. Prerequisite: evaluate bundle size, test MapLibre GL compat.

---

## Distribution

- **Chrome extension** — button on each GitHub `/owner/repo` page, opens the map without leaving GitHub. The real usage multiplier (see star-history.com's growth). Most impactful single distribution move.

- **Embeddable widget** — `<iframe src="starmapper.bruniaux.com/embed/owner/repo">` for READMEs. Interactive map directly in the repo page.

- **CLI** — `npx starmapper owner/repo` generates a standalone `map.html`. For developers who want an offline artifact.

---

## Priority order

1. **Chrome extension** — plus gros levier de distribution. Manifest V3, content script sur pages GitHub.
2. **Watch mode** — poll during launches, pulsing badge on new stars.
3. **Jawg Places JS** — replace autocomplete proxy routes with client-side library.

---

## If monetization ever

- **Trending page** — "These repos are gaining stars in Berlin this week." Organic traffic.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Retention and natural upsell.
