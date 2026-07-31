# StarMapper Roadmap

*Last updated: 2026-07-31, v0.6.11*

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
- **Claude Code / MCP integration**: `starmapper-mcp` npm package with 9 tools (`get_repo_stats`, `get_organic_score`, `get_velocity`, `get_influential_stargazers`, `index_repo`, `health_check`, `get_cache_status`, `get_trending`, `list_repos`). New public endpoints `GET /api/mcp/organic-score`, `GET /api/mcp/influential`, and `GET /api/mcp/cache-status`. (v0.6.0)
- **Dependents Explorer** `/[owner]/[repo]/dependents`: table of repos depending on a library, sorted by stars/forks/name. Data source flipped to ecosyste.ms (multi-ecosystem, no API key, 7-day Neon cache). `DependentsCache` model. Refresh route with 1h cooldown. MCP tool `get_dependents` (10th tool). Feature-flagged via `NEXT_PUBLIC_DEPENDENTS_ENABLED`. (v0.6.3)
- **Followers Map** `/[owner]/followers`: interactive map of a GitHub user's followers, same geocoding cascade and cluster rendering as repo maps. Side panel with virtual scroll, fly-to on click, follower influence sort. Entry points on all profile pages. (v0.5.9)
- **Followers user switcher** (v0.6.1): command-palette modal on the followers page to switch to any other GitHub user without leaving the page. Searches GitHub users with 200 ms debounce, keyboard navigation.
- **SEO and PWA pass** (v0.6.2): og:image sitewide via `@vercel/og`, PWA web manifest, JSON-LD structured data in root layout, `sitemap.ts`, `robots.ts`, `icon.svg`.
- **Repos table filter bar and dependents column** (v0.6.4): language chip toggles, "Has dependents" and "Has score" chips, sortable Deps column linking to the dependents page. `dependentsCount` added to `MappedRepo` via LEFT JOIN on `dependents_cache`.
- **Dependents table report flag** (v0.6.4): flag button per row opens a pre-filled GitHub issue to report an incorrect dependent from ecosyste.ms.
- **Contributors Map** (v0.6.7): `/[owner]/[repo]/contributors` geocodes repo contributors on an interactive map, dot size proportional to commit count, side panel sorted by commits, GraphQL batch location fetch, auto-start on revisit, onboarding tour. Entry points: `/repos` table column, announcement banner, landing explore section.

---

## Next — prioritized

See "Strategic pivot: inverted data model" below, the only prioritized work right now. Everything else sits in Medium term.

---

## Strategic pivot: inverted data model

### Why

GitHub disabled `Repository.stargazers` enumeration on every surface, GraphQL, REST, and the web UI, on 2026-07-23. That single field was the entire data source of the classic scan (`/api/chunk`). `starredRepositories(user)`, the inverse edge, stays open. Full investigation and evidence: `claudedocs/github-stargazers-restriction.md`. The reframe: stop trying to scan a repo for its stargazers, and instead crawl known users' starred repos, then reconstruct any repo's map from our own database.

### Assets in hand

The measured DB, no new work required to read these numbers: `github_user` 7.24M rows (2.21M geolocated, 30%), `star_event` 33M user-repo links across 2642 repos, `stargazer_cache` 2642 repos already cached from prior scans.

### Phases

- **Phase 0, leave-one-out gate (S, go/no-go).** Do not run a naive self-join (a fully-scanned repo's own stargazers are already in `star_event`, so that query returns close to 100% by construction and measures nothing). Instead, take several fully-scanned repos, pretend each is unknown, and count how many of its real stargazers we'd still recover purely from non-stargazer discovery sources (followers, following, contributors) already in the DB. Commit a numeric threshold before running it, for example: median leave-one-out coverage below roughly 20% on mid-size repos (1k-50k stars) means do not build the crawler, go straight to the fallback below. Zero new API calls, pure SQL against the existing 33M rows.

- **Phase 1, reconstruction read path (M, ships now, decoupled from the crawler).** This is the near-term win, and it does not wait on Phase 3 or on any crawler decision. New route `GET /api/reconstruct/[owner]/[repo]`: raw SQL join of `star_event` and `github_user` on `login` filtered by `owner`/`repo`, split into mapped (lat/lng not null) and unmapped, coordinates rounded to 2 decimals matching the existing convention at `chunk/route.ts:183`, points shaped as `StargazerPoint` (bio null, avatar from `github.com/{login}.png`). Read precedence: `stargazer_cache` first for the 2642 already-cached repos, `/api/reconstruct` otherwise. Repo pages fall back to it behind `NEXT_PUBLIC_RECONSTRUCT_ENABLED`. New `fetchStarredReposPage` in `github.ts` lands here too, even though Phase 1 itself makes zero new GitHub calls, later phases reuse it.

- **Phase 1b, live engaged-audience map (M, no crawl, no ToS risk). DONE, shipped 2026-07-26 (`570a367`), gated behind `ENGAGED_AUDIENCE_ENABLED` (default off).** A third path the probe surfaced (`scripts/probe-github-access.ts`, full inventory in `claudedocs/github-api-surface-inventory.md`). GitHub killed `stargazers`, but several repo-to-users connections stayed open on GraphQL, each returning `login` and `location` inline at 1pt/page: `repository.forks{ owner }` (50k on react), `repository.issues{ author }` (14.5k), `repository.pullRequests{ author }` (13k), `repository.mentionableUsers` (1.7k), REST `contributors`, plus `repository.watchers` (6.6k). Build a per-repo map on demand from the union of these, deduplicated. It is not the stargazers, it is a smaller engaged slice (roughly 25-30% of the star count on react, measured), so the copy reframes from "everyone who starred" to "the engaged community". Durable core is forks + issues + PRs + mentionable + contributors, none on the restriction list. `watchers` is a bonus that may close (it IS on the list, REST `subscribers` already 404s), so build the union to degrade cleanly without it. This is the only path that works on a repo StarMapper has never seen, with no crawl and no legal read. Strongest near-term bet.

- **Phase 2, geolocated coverage metric (M).** Surface `0.3 * N / M`, not raw `N / M`. N is the distinct login count we hold for the repo in `star_event`, M is `stargazerCount` (still callable, only enumeration is blocked, so M stays readable). Raw N/M overstates what actually renders as a dot on the map by roughly 3x, since only the geolocated 30% of `github_user` produces a point. Indicator copy needs to read "we've located X of an estimated Y stargazers," with X being the geolocated count.

- **Phase 3, crawler (L, conditional on Phase 0's number AND a legal read, do not start without both).** New `scripts/crawl-user-stars.ts` driven by a new `user_star_crawl` table, walking `starredRepositories(first: 100, after, orderBy: STARRED_AT_DESC)` per known user, geolocated users prioritized first, token rotation across the existing 4 `GITHUB_TOKEN` slots. This phase does not start until Phase 0 clears its committed threshold and the ToS read in the risks section below comes back clean.

- **Phase 4, discovery channels (M).** Following-graph BFS is the highest-ROI replacement for stargazer-based discovery, since location comes back inline on follow edges and doubles as geolocation enrichment. After that: followers (`fetchFollowersPage`, already exists), org `membersWithRole`, `fetchContributorsPage` (already exists, 500-user cap), commit authors. All still-open endpoints, none touch `Repository.stargazers`.

- **Phase 5, freshness (S/M).** Per-user incremental crawl: page `STARRED_AT_DESC`, stop as soon as `starredAt <= latestStarredAt`, the same stop-marker pattern already used by the `since` handling at `github.ts:159`, then persist the newest `starredAt`. A 30-day staleness cron re-enqueues `done` users and clears their cursor.

- **Phase 6, route cleanup (S).** `/api/chunk` returns 410 once the reconstruction path is trusted. `badge-update` flips from client-triggered to the freshness cron. Flags: `NEXT_PUBLIC_RECONSTRUCT_ENABLED`, `STARGAZER_SCAN_ENABLED=false`. Contributors, followers, trending, atlas, explore, and dependents routes are untouched, none of them ever called `Repository.stargazers`.

### Data model

New `user_star_crawl` table: `login` (PK), `status` (`pending`/`in_progress`/`done`/`error`), `priority` (int), `cursor`, `latestStarredAt`, `lastCrawledAt`, `discoverySource`. Indexes on `(status, priority desc)` and `(lastCrawledAt)`. Two new columns on `BadgeCache`: `knownCount`, `coverageComputedAt`. `star_event` is reused as-is: its `@@unique([login, owner, repo])` already gives idempotent upserts via `skipDuplicates`, and its existing `@@index([owner, repo, login])` is what makes the Phase 1 reconstruction query fast without adding anything new. Neon DDL rule still applies for the new table: no `CREATE INDEX CONCURRENTLY` (triggers a PANIC on Neon), prefix scripts with `SET statement_timeout = 0;`.

### Risks, ranked

1. **ToS and circumvention (BLOCKER).** Mass-crawling `starredRepositories` to rebuild the exact stargazer lists GitHub just restricted reads as direct circumvention, not a workaround of an incidental limit. Pooling GraphQL quota across 3 accounts and 4 tokens is itself ToS-fragile, independent of the crawl's purpose. Blast radius if flagged: all 4 tokens and their accounts banned, not just rate-limited. A legal/ToS read is required before Phase 3, this is not something to engineer around.

2. **GraphQL point-cost uncertainty (HIGH).** The crawl timeline for the geolocated pool swings by roughly 10x depending on whether `starredRepositories` costs about 1pt/request, about 0.1pt (like the existing stargazer query), or something driven by the nested `node { stargazerCount }` connection: roughly 9 days versus roughly 90. Neither number is trustworthy until a measured spike (crawl 100 heavy-follower users, read the actual `x-ratelimit-cost` header) replaces the estimate. Secondary and abuse rate limits, not the primary points budget, are the more likely wall in practice.

3. **Silent DB-health no-op (HIGH).** `bulkUpsertStarEvents` and `bulkInsertUsersMinimal` in `src/lib/user-cache.ts` silently skip their writes when DB health is degraded or `usagePct` is high, by design, for the existing chunk loop. A multi-week crawl loop that doesn't check the return value will mark `lastCrawledAt` as done for users whose `star_event` rows were never actually written. The crawl loop has to treat a skip as "retry this user later," never as completion.

4. **Coverage honesty (MEDIUM-HIGH).** Because only 30% of known users are geolocated, an under-covered repo's map can look sparse or broken even when the raw N/M number looks fine. The Phase 2 indicator wording is product-critical, not cosmetic, it has to describe what's actually visible, not what's stored.

5. **star_event growth (MEDIUM).** Projected growth from 33M rows to somewhere between 500M and 1B, with three indexes to keep current. `COUNT(DISTINCT login)` and the join behind reconstruction get slower on Neon as the table grows. Storage itself isn't the constraint (Neon is sponsored), latency and autovacuum behavior at that row count are.

6. **GDPR basis shift (MEDIUM).** The existing LIA and DPIA cover user-initiated, on-demand scans of a repo the visitor asked for. A 24/7 proactive crawl of millions of accounts, with no triggering user request, is a materially broader legal basis and needs a DPIA revision before Phase 3, not after.

### Bottom line

Ship Phase 1 first. The reconstruction read path is low-risk, delivers value today over the 33M `star_event` rows already in hand, and needs neither the crawler nor a ToS decision to exist. Treat the crawler (Phase 3) as fully conditional on Phase 0's leave-one-out number clearing its committed threshold and on the ToS/legal read landing clean. The two are separable, keep building and shipping them that way.

### Fallback

If the leave-one-out simulation doesn't clear the gate, or the ToS read comes back negative, recenter on Contributors Map and Followers Map. Both already exist, both use endpoints verified returning HTTP 200 on 2026-07-23, and neither depends on `Repository.stargazers` in any form.

---

## Medium term

- **Starred-by-user map** — From `/profile/[login]`, aggregate map of stargazers from ALL repos starred by that user (already indexed in StarMapper). Route `GET /api/profile/[login]/starred-map`. "Where do people who like what I like live?" No existing tool crosses user-stars × geography.

- **Dependents geo map** (Phase 3): geocode the owners of dependent repos and render them on a StarMapper map. Toggle between table and map on `/[owner]/[repo]/dependents`. Cap 200 owners to bound Nominatim cost.

- **GitHub traffic metrics**: page views (total + 14-day uniques) and clone count (total + 14-day uniques) via `GET /repos/{owner}/{repo}/traffic/views` and `/clones`. Requires a token with push access on the target repo (not available for arbitrary public repos; user provides their own PAT). Display in Stats modal. `GET /api/stats/[owner]/[repo]/traffic`. TTL 24h in Neon.

- **Contributor count**: `GET /repos/{owner}/{repo}/contributors?per_page=1` + `Link` header gives total contributors. Simple addition to `repo-info` response and Stats modal. Also feeds Organic Score as a direct signal (currently derived indirectly from forks).

- **Search mentions / adoption breadth**: GitHub Search API counts for issues, PRs, and discussions that mention a package or repo name (`GET /search/issues?q={name}+in:body`). Shows adoption across third-party projects. Candidate additional signal for Organic Score. `GET /api/stats/[owner]/[repo]/mentions`.

- **Anonymous star-count scrape** (raised by Livio Gamassia on the roadmap vote, 2026-07-30): the exact star count is present in the repo page DOM even fully logged out, confirmed via incognito browsing and DevTools inspection (`aria-label="241143 users starred this repository"`, `title="241,143"`, no rounding). `stargazerCount` already covers this via GraphQL/REST at near-zero quota cost (`github-stargazers-restriction.md:45`), so this scrape recovers nothing new, only a zero-quota alternative when the actual constraint is API budget, e.g. very high-volume badge or trending checks against thousands of repos. Legal status unresolved either way: the only sourced AUP clause (`audit-rgpd-legal-2026-04-17.md:26`) targets scraping for spam or personal-data resale, doesn't cleanly cover a personal-data-free count, but no broader GitHub anti-bot clause has been checked yet. Do not implement before that check. Not a fix for the stargazer-list restriction, it never touches enumeration.

### Ideas from meet-the-fans (evoluteur), audited 2026-07-23

- **Cross-repo fan signal into Organic Score** (highest ROI): a single account that stars several of an owner's indexed repos is a strong organic marker. Bought stars are one-shot, real fans recur. This closes the `cross-repo clustering` gap deferred in the bought-stars analysis (see `docs/organic-score.md`). The data already exists: `power_users_mv` and `repo_power_users_mv` aggregate multi-repo stargazers, and the Stats "Power" tab already surfaces them. New work is only wiring a "distinct repos starred by this user" count as a signal in `src/lib/organic-score.ts`, alongside the contributor-count and search-mentions candidates above. Low effort, hard to fake.

- **Forkers as an engagement signal**: forking a repo (cloning to build on it) is a stronger signal than a star. StarMapper is star-only today. Surface forkers somewhere, or at minimum weight them higher than stars in the Organic Score. `forkCount` is already in `repo-info`; a forkers list needs a GraphQL `forks { nodes { owner } }` fetch.

- **star-history.com deeplink**: per-repo outbound link to `star-history.com/#owner/repo`. Star history over time stays out of scope (that is star-history.com's product), but a deeplink offers the value for free with zero maintenance. Small addition to the repo popup / Stats modal.

---

## If monetization ever

- **CSV export** — `login, country, city, lat, lng, followers` per scan. Data is already in memory client-side. Natural upsell or API-key-gated feature.
- **Email alerts** — "10 new stargazers this week, 3 from Microsoft." Requires auth/accounts.
- **Audience report PDF** — Exportable deck for sponsors or enterprise pitches.
