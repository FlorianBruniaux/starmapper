# StarMapper Roadmap

*Last updated: 2026-05-11 — v0.4.6*

---

## Done

- **Badge README** — `/api/badge/[owner]/[repo]` SVG shield, 6h CDN cache. Sidebar button + Share modal with live preview and copy Markdown.
- **Repo bookmarks** — localStorage, recent repos list on the landing page.
- **Share card** — PNG export of the map + stats, LinkedIn sharing with pre-filled text.
- **Client-side cache compression** — Web CompressionStream (gzip+base64) before `POST /api/stargazer-cache`. Fixes timeouts on 50k+ star repos.
- **Geocache pre-seeding** — ~51k GeoNames entries, >99% hit rate on real scans.
- **Stats panel** — 6 summary cards, company badges on Top Stars, sort toggle, Power tab (cross-repo stargazers via `star_event` group by).
- **Language Atlas** — `/devs/atlas`, choropleth map showing the dominant language per country. Based on starred and contributed repos.
- **Dev Maps by language** — `/devs` + `/devs/[language]`, developer map filtered by programming language.
- **Explore page** — `/explore` leaderboard: top stargazers by followers and public repos, top companies, top locations, filterable by country and company. Cross-repo funnel.
- **Heatmap mode** — toggle dots vs heat density on the map. Native MapLibre `heatmap` layer, toggled from the dock.
- **Multi-repo compare** — overlay two repos on the same map to see audience overlap.
- **Animated timelapse** — weekly buckets replay on the map, speed selector (0.5×→4×). Data source: `starredAt` from `star_event`.
- **Public GeoJSON API** — `GET /api/geo/[owner]/[repo]` with API key auth. Aggregate countries + cities only (RGPD-safe). Rate-limited via Upstash.
- **Profile page `/profile/[login]`** — Profile card, 2/3 content + 1/3 map layout. Reverse lookup: starred repos, owned repos grid, developers nearby. All `@login` links point here.
- **Profile refresh** — "Refresh" re-fetches from GitHub API (1h cooldown). Auto-fetch on 404.
- **Contact dropdown** — GitHub, LinkedIn, email (obfuscated), blog fetched on-demand. No `mailto:` in DOM.
- **Page view tracking** — `POST /api/track` daily view counts per repo and profile. `pnpm stats:views` CLI.
- **Organic Score** — 0–100 score based on forks, zero-dependency forks, watchers, open issues/PRs. `OrganicScorePill` on repo cards. `GET /api/organic-score/[owner]/[repo]`.
- **News & RSS feeds** — Devs publish short announcements (280 chars) on their profile via GitHub PAT. RSS 2.0 + JSON Feed 1.1 per profile. Page `/feed/[login]` for subscriptions.
- **Trending map** — `/trending`, carte agrégée des repos trending × stargazers géographiques. Source : GitHub Search API + cron quotidien. `trending_repos_mv`.
- **Changelog page** — `/changelog`, timeline versionnée servie depuis `CHANGELOG.md` au build.
- **GitHub Repos section on profile** — Top repos grid (up to 8, from `topRepos` in DB) on `/profile/[login]`.
- **Map a repo modal** — Full repo picker on profile pages: up to 500 repos, searchable, sortable. Navigates directly to the StarMapper map.
- **Deep link sharing** — Share modal encodes active filters (country, city, company, followers, date, tier, view mode) as URL params. "Shared view" pill on load.
- **Velocity indicator** — Stats modal shows `+N/mo` in green, computed from `starredAt` in memory.
- **Explore deep links** — Changing filters or selecting a country on `/explore` updates the URL (`?tab=`, `?country=`, `?q=`, `?map=`). Shareable and bookmarkable.
- **Choropleth country highlight** — Selected country on `/explore` choropleth gets a blue fill overlay + white 2.5px border. Pill in map header to dismiss.
- **Scan date in SVG badge** — `/api/map-image` footer shows `· May 2026` from last scan date.
- **Map image README embed** — "README Badge" modal has two tabs: "Map image" (full SVG scatter map, `<picture>` dark/light via `/api/map-image/[owner]/[repo]?theme=`) and "Shield badge" (text shield). Copy HTML in one click.
- **Chrome Extension (Manifest V3)** — Bouton "★ Map" sur chaque page GitHub `/owner/repo`. Content script, background service worker (context menu), popup avec recherche. Build Vite + @crxjs/vite-plugin v2. `cd extension && npm install && npm run build`.
- **Watch mode** — Polling GitHub toutes les 60s pendant un launch. Affiche `+N ★ · India, Germany` avec un point vert pulsant. Arrêt automatique après 10 min sans nouvelle étoile. `GET /api/watch/[owner]/[repo]?since=<ISO>`, no-store, aucune écriture DB.
- **Notable stargazers** — Top 5 par followers sous forme de chips d'avatars dans le modal Stats, visibles immédiatement sans changement d'onglet. Données depuis les points déjà en mémoire, aucun appel API.
- **Geographic velocity** — Onglet "Rising" dans le modal Stats : compare le rythme quotidien 30j au rythme 31–90j par pays. Statuts : rising (×1.5+), new, stable, declining. `GET /api/stats/[owner]/[repo]/geo-velocity`, cache CDN 5 min.

---

## Next — prioritized

### 1. Star growth timeline

A chart on the `/[owner]/[repo]` page showing star accumulation over time — one data point per week/month. Complements the `+N/mo` velocity indicator already in the stats modal: the number tells you the rate, the chart shows the shape (steady growth? viral spike? plateau?).

Data source: `star_event.starredAt` already in DB for indexed repos. No new data collection needed. Rendering: lightweight SVG or canvas chart (no heavy charting lib). Natural pairing with the timelapse feature already built.

**Effort:** 1–2 days. **Lever:** completeness vs Star History, which does this better than anyone — but only StarMapper combines it with the geo view.

---

## Medium term

- **Starred-by-user map** — From `/profile/[login]`, aggregate map of stargazers from ALL repos starred by that user (already indexed in StarMapper). Route `GET /api/profile/[login]/starred-map`. "Where do people who like what I like live?" No existing tool crosses user-stars × geography.

---

## If monetization ever

- **CSV export** — `login, country, city, lat, lng, followers` per scan. Data is already in memory client-side. Natural upsell or API-key-gated feature.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Requires auth/accounts.
- **Audience report PDF** — Exportable deck for sponsors or enterprise pitches.
