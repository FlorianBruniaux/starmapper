# StarMapper Roadmap

*Last updated: 2026-05-19 — v0.5.0*

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
- **Trending map** — `/trending`, aggregate map of trending repos × stargazer geography. Source: GitHub Search API + daily cron. `trending_repos_mv`.
- **Changelog page** — `/changelog`, versioned timeline served from `CHANGELOG.md` at build time.
- **GitHub Repos section on profile** — Top repos grid (up to 8, from `topRepos` in DB) on `/profile/[login]`.
- **Map a repo modal** — Full repo picker on profile pages: up to 500 repos, searchable, sortable. Navigates directly to the StarMapper map.
- **Deep link sharing** — Share modal encodes active filters (country, city, company, followers, date, tier, view mode) as URL params. "Shared view" pill on load.
- **Velocity indicator** — Stats modal shows `+N/mo` in green, computed from `starredAt` in memory.
- **Explore deep links** — Changing filters or selecting a country on `/explore` updates the URL (`?tab=`, `?country=`, `?q=`, `?map=`). Shareable and bookmarkable.
- **Choropleth country highlight** — Selected country on `/explore` choropleth gets a blue fill overlay + white 2.5px border. Pill in map header to dismiss.
- **Scan date in SVG badge** — `/api/map-image` footer shows `· May 2026` from last scan date.
- **Map image README embed** — "README Badge" modal has two tabs: "Map image" (full SVG scatter map, `<picture>` dark/light via `/api/map-image/[owner]/[repo]?theme=`) and "Shield badge" (text shield). Copy HTML in one click.
- **Chrome Extension (Manifest V3)** — ★ Map button on every GitHub `/owner/repo` page. Content script, background service worker (context menu), toolbar popup with search and recent repos. Build: WXT. `cd extension && npm run build`.
- **Watch mode** — Polls GitHub every 60s during a launch. Shows `+N ★ · India, Germany` with a pulsing green dot. Auto-stops after 10 min with no new star. `GET /api/watch/[owner]/[repo]?since=<ISO>`, no-store, no DB writes.
- **Notable stargazers** — Top 5 by followers as avatar chips in the Stats modal, visible immediately without switching tabs. Data from in-memory scanned points, no API call.
- **Geographic velocity** — "Rising" tab in the Stats modal: compares 30-day daily rate vs 31–90-day rate per country. Statuses: rising (×1.5+), new, stable, declining. `GET /api/stats/[owner]/[repo]/geo-velocity`, 5-min CDN cache.
- **Star growth timeline** — "Growth" button in the Dock, bar chart of weekly star accumulation. `GET /api/stats/[owner]/[repo]/growth` (SQL `DATE_TRUNC('week')`, 5-min CDN cache). Falls back to in-memory `starredAt` data for recent scans. (v0.4.8)
- **Landing redesign** — Hero split layout: form on the left, animated 3D globe on the right. Dedicated `/faq` page extracted from the landing. (v0.4.9)
- **Jawg dual-token failover** — `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2` auto-switches if the primary token returns 401/402/403/429. (v0.4.9)
- **Trending page nav** — `/trending` added to sitemap and navigation. (v0.4.9)
- **Comparison page** — `/vs/star-history` with structured data and UTM tracking. (v0.4.9)
- **Environment validation** — `src/env.ts` via `@t3-oss/env-nextjs`. Build fails fast if `DATABASE_URL`, `GITHUB_TOKEN`, or `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` are missing. (v0.5.0)
- **Trending split endpoints** — `GET /api/trending/repos` and `GET /api/trending/map` replace the monolithic endpoint. Repos list renders before the map. `loading.tsx` skeleton. (v0.5.0)
- **Claude Code / MCP integration**: `starmapper-mcp` npm package with 5 tools (`get_repo_stats`, `get_organic_score`, `get_velocity`, `get_influential_stargazers`, `index_repo`). New public endpoints `GET /api/mcp/organic-score` and `GET /api/mcp/influential`. (v0.6.0)

---

## Next — prioritized

No new items currently queued. See Medium term for backlog.

---

## Medium term

- **Starred-by-user map** — From `/profile/[login]`, aggregate map of stargazers from ALL repos starred by that user (already indexed in StarMapper). Route `GET /api/profile/[login]/starred-map`. "Where do people who like what I like live?" No existing tool crosses user-stars × geography.

---

## If monetization ever

- **CSV export** — `login, country, city, lat, lng, followers` per scan. Data is already in memory client-side. Natural upsell or API-key-gated feature.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Requires auth/accounts.
- **Audience report PDF** — Exportable deck for sponsors or enterprise pitches.
