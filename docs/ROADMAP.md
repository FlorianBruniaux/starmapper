# StarMapper Roadmap

*Last updated: 2026-05-11 — v0.4.3*

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

---

## Next — prioritized

### 1. Geographic velocity

"India discovered your repo this quarter — +3× vs last quarter. Germany is a new market."

Reads `star_event.starredAt + github_user.countryNormalized` already in DB. Groups by country × rolling 30/90 day windows. Surfaces in the stats panel as a "Rising countries" row. No one else does this — all competitors answer "how fast are you growing?", StarMapper can answer "where is your new growth coming from?".

**Effort:** 1–2 days. **Lever:** unique differentiator, no competition.

---

### 2. Star growth timeline

A chart on the `/[owner]/[repo]` page showing star accumulation over time — one data point per week/month. Complements the `+N/mo` velocity indicator already in the stats modal: the number tells you the rate, the chart shows the shape (steady growth? viral spike? plateau?).

Data source: `star_event.starredAt` already in DB for indexed repos. No new data collection needed. Rendering: lightweight SVG or canvas chart (no heavy charting lib). Natural pairing with the timelapse feature already built.

**Effort:** 1–2 days. **Lever:** completeness vs Star History, which does this better than anyone — but only StarMapper combines it with the geo view.

---

### 3. Notable stargazers panel

A "Notables" section in the stats panel / drawer: top 10 stargazers ranked by followers. "CEO of X, contributor to Y, 12k followers starred your repo." Data already in `github_user.followers`. Signals credibility to maintainers and gives them a reason to share the map ("look who's watching this").

**Effort:** 0.5 day. **Lever:** insight with zero new data collection.

---

### 4. Watch mode

Poll every ~60s during a launch, display `+3 new stars — Paris, Toronto` with a pulsing badge. Stop after inactivity. Useful during HN/PH launches or Twitter spikes — the moment maintainers are most likely to share the map.

**Effort:** 1 day. **Lever:** engagement at the highest-value moment.

---

### 5. Chrome extension

Button on each GitHub `/owner/repo` page opens the StarMapper map without leaving GitHub. Manifest V3, React content script. The most impactful single distribution move — meets users where they already are.

**Effort:** 1–2 weeks. **Lever:** distribution at source, referenced growth lever for star-history.com.

---

## Medium term

- **Starred-by-user map** — From `/profile/[login]`, aggregate map of stargazers from ALL repos starred by that user (already indexed in StarMapper). Route `GET /api/profile/[login]/starred-map`. "Where do people who like what I like live?" No existing tool crosses user-stars × geography.

---

## If monetization ever

- **CSV export** — `login, country, city, lat, lng, followers` per scan. Data is already in memory client-side. Natural upsell or API-key-gated feature.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Requires auth/accounts.
- **Audience report PDF** — Exportable deck for sponsors or enterprise pitches.
