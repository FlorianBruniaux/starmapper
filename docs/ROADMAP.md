# StarMapper Roadmap

*Last updated: 2026-04-16 — v0.3.1*

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

---

## Quick wins (1-2h each)

- **Public GeoJSON API** — `GET /api/geo/[owner]/[repo]` returns the GeoJSON for a cached scan. For researchers, journalists, developers who want to build on top of it.

---

## Medium term

- **Profile page `/profile/[login]`** — Dedicated page per GitHub user. The reverse lookup: instead of "who stars this repo?", it's "which repos does this person star?". Shows all StarMapper repos they starred, a mini-map if geocoded, followers/company/account age, and "people nearby" from the same city or company. Every login becomes an indexable page — serious SEO surface (thousands of pages).

  Endpoint: `GET /api/profile/[login]` reading `github_user` + `star_event WHERE login`.
  Risk: data freshness (`followers` is from the last scan date), privacy link to GitHub source.

- **Watch mode** — poll every few minutes during a launch, display "+3 new stars in Paris" with a pulsing badge. Useful during launches and spikes.

- **Animated timelapse** — replay the arrival of stars over time on the map. `StarEvent.starredAt` is already stored. Visually compelling and shareable.

- **Jawg Places JS integration** — replace the `/api/explore/autocomplete` + `/api/explore/geocode` proxy routes with the official Jawg Places JS client-side library. Instant suggestions without a round-trip, less server code. Prerequisite: evaluate bundle size, test MapLibre GL compat.

---

## Distribution

- **Chrome extension** — button on each GitHub `/owner/repo` page, opens the map without leaving GitHub. The real usage multiplier (see star-history.com's growth). Most impactful single distribution move.

- **Embeddable widget** — `<iframe src="starmapper.bruniaux.com/embed/owner/repo">` for READMEs. Interactive map directly in the repo page.

- **CLI** — `npx starmapper owner/repo` generates a standalone `map.html`. For developers who want an offline artifact.

---

## Priority order

1. **Animated timelapse** — frontend only, `starredAt` data already stored, high social ROI
2. **Public GeoJSON API** — 0.5 day, unlocks third-party use cases
3. **Profile `/profile/[login]`** — SEO and new acquisition funnel (API shell exists)
4. **Chrome extension** — biggest distribution lever

---

## If monetization ever

- **Trending page** — "These repos are gaining stars in Berlin this week." Organic traffic.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Retention and natural upsell.
