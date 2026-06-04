# Changelog — StarMapper

History of significant changes to the project.
Versioning: Semantic Versioning (MAJOR.MINOR.PATCH)

---

## [0.5.9] (2026-06-04)

### Followers Map

A GitHub user's followers can now be mapped, exactly like a repo's stargazers. Every developer profile on StarMapper gains a `/[owner]/followers` page: an interactive map with GeoJSON clustering, a side panel listing followers sorted by influence (follower count), fly-to on click, and virtual scroll for large lists.

- **`/[owner]/followers` page**: full-screen map + `FollowersPanel` side panel with virtual scroll, fly-to on marker click, and a summary badge (mapped / total).
- **Profile page entry points**: the followers count badge on `/profile/[login]` is now a link to the followers map. A "Map followers" action button appears in the profile actions row.
- **Announcement banner + More to Explore**: the site-wide banner promotes the followers map feature; the "More to Explore" section on the landing page includes a followers map card.
- **`/api/followers-chunk`**: new POST endpoint. Fetches 100 followers per call via GitHub GraphQL, geocodes locations through the standard 3-tier cascade (Jawg, Geoapify, Nominatim), applies the 30-day stale cache strategy, and returns `FollowerPoint[]` + `unmapped[]`. Distributed rate limiting via Upstash (30 req/min per IP, 300 req/h per PAT). IP rate limiting is skipped in development.
- **`useFollowersScanController`**: client-side hook that drives the `/api/followers-chunk` loop sequentially, accumulates points progressively, and surfaces quota remaining.

### Ops scripts

- **`scripts/ops/index-followers.ts`**: single-user followers geocache warm-up. Drives the API loop for one login (`make index-followers LOGIN=owner`).
- **`scripts/ops/batch-index-followers.ts`**: batch geocache warm-up for all users in DB with ≥N followers (default 100). Calls `fetchFollowersPage` + `geocodeBatch` directly, no HTTP server required. Multi-token rotation reads `GITHUB_TOKEN`, `GITHUB_TOKEN_2`… and parks exhausted tokens on GitHub 429 instead of waiting.
- **`scripts/ops/index-repo.ts`**: drives the `/api/chunk` loop for any repo to pre-warm its geocache. Supports `--base-url` for local dev.

### Bug Fixes

- **Followers page sticky header**: fixed map overlap caused by non-sticky header on the followers page.
- **Touch targets on FollowersPanel**: replaced arbitrary Tailwind values with standard spacing classes for 44px minimum touch targets.

---

## [0.5.8] (2026-05-28)

### Accessibility

- **WCAG AA pass, 9 violations fixed.** Six text inputs (`explore` city search, login/name search, `profile` repo search, `[owner]` repo search and min-stars filter, map `top-panel` username input) were missing accessible names and now carry explicit `aria-label` attributes. The min-stars `<label>` is now programmatically linked via `htmlFor`/`id`. The `StarNudge` popup (role: dialog) gains keyboard dismissal via Escape. The unmapped-stargazers bottom drawer gains `role="region"`, `aria-label`, and Escape-to-close.
- **Dark-mode contrast raised to WCAG AA.** `text-muted-subtle` token in dark mode bumped from `#848d97` (4.2:1 ratio — below threshold) to `#8b929a` (~4.55:1). Affects secondary labels, breadcrumb separators, and stat hints across all pages.

### SEO

- **Metadata added to two high-traffic unindexed routes.** `/trending` now has a dedicated `layout.tsx` with title, description, OG, Twitter card, and canonical. `/[owner]` (user scan page) has `generateMetadata` producing a dynamic title `{owner}'s repos | StarMapper` and a canonical URL.
- **OG / Twitter / canonical added to 6 secondary pages.** `/privacy`, `/terms`, `/legal`, `/changelog`, `/sponsor`, and `/organic-score/calibration` now carry full social metadata alongside their existing title and description.
- **JSON-LD root sanitization aligned.** Root `layout.tsx` now applies `.replace(/</g, "\\u003c")` on the JSON-LD payload, consistent with the per-repo and profile layouts.

### Performance

- **Three raw `<img>` tags in `/explore` replaced with `<Image>`.** Avatar thumbnails in the Top Contributors, Power Users, and Nearby Developers panels now use Next.js `<Image>` with `loading="lazy"`, enabling automatic AVIF/WebP delivery via the optimizer.

---

## [0.5.7] (2026-05-28)

### Performance

- **App Router SC/CC split on 3 major pages.** `[owner]/[repo]`, `/explore`, and `/profile/[login]` were monolithic "use client" pages with no server-side rendering. Each now has a Server Component wrapper that pre-fetches the critical-path data (repo info, explore summary, profile) and passes it as `initialData` to the client component. The client-side fetch becomes a fallback (private repo, 404, network error) instead of the default path. LCP improves for all three routes; crawlers and social preview bots see real HTML content on first byte.
- **`map-style-urls.ts` extracted from `theme.ts`.** `MAP_STYLE_DARK`, `MAP_STYLE_LIGHT`, `Theme`, and `MapProjection` moved to a server-safe module with no `"use client"` marker. `theme.ts` re-exports them for backward compatibility. Prevents accidental bundle pollution if a server component ever imports map URL builders.

### Bug Fixes

- **`sanitizeError` missing from `refresh-grid-mv` test mock.** The route imported `sanitizeError` from `@/lib/api-helpers` (added in 0.5.6) but the Vitest mock factory did not expose it. The function was added to the mock; the 1 failing test now passes (895/895).

### Internal

- **`JawgBadge` component made server-safe.** `"use client"` removed from `src/components/map/jawg-badge.tsx`. The component is a static `<a>` tag with no hooks or browser APIs; the directive served no purpose.

---

## [0.5.6] (2026-05-28)

### Performance

- **Prisma query payload reduction.** Five `findUnique` calls without `select` now fetch only the columns actually consumed: `badge-update` fetches `totalCount` only (was all 15+ columns), `map-image` fetches 4 badge columns, `stargazer-cache GET` fetches `updatedAt` for the fallback path and explicit 5-column select for the full row. Reduces data transferred from Neon on every scan completion and every map image generation.
- **`organic-score-stats` SQL aggregate.** The admin stats endpoint was loading all `badge_cache` rows into Node.js memory for in-memory aggregation. Replaced with two parallel `$queryRaw` GROUP BY queries (per-tier counts + per-bucket distribution via `width_bucket`). Memory footprint is now O(1) regardless of table size.

### Internal

- **`import-geocache` bulk upsert.** N+1 pattern (one `prisma.geoCache.upsert` per row inside a nested loop) replaced with a single `$queryRaw` UNNEST INSERT ... ON CONFLICT DO UPDATE per batch of 500. Same pattern as `bulkUpsertUsers` in `user-cache.ts`. Admin dev-only route, blocked in production.
- **GDPR deletion atomicity.** `delete-user` route wraps `starEvent.deleteMany` + `gitHubUser.delete` in `prisma.$transaction([...])`. Prevents partial deletion if the process crashes between the two operations.

---

## [0.5.5] (2026-05-27)

### UX

- **Token modal clarity.** Reframed "GitHub Access Token" as "Speed Boost: GitHub Token" to remove the auth/login connotation. Added a trust banner ("No account, no login, no signup. A GitHub token is just a speed pass for the API") with a Shield icon. Copy simplified: 60 vs 5,000 req/hr now explicit, link reads "Create a free token (zero permissions)". Modal widened to `max-w-lg`. Browser-native password reveal/autofill icons suppressed via CSS.
- **Data freshness communication.** A "Data updates when someone refreshes, not in real time." line now appears under the cache status row. Lock icon tooltips on Refresh and Full rescan buttons explain "Add a free GitHub token for faster scanning. No login needed."
- **Community cache model explained.** Pre-scan overlay rewritten: "Results are shared with everyone. When you scan, all future visitors see your results instantly." The 50k+ token warning now says "free token / zero permissions / no login, no signup." and "Add a free token (takes 30 sec)".
- **FAQ additions.** Two new entries: "Do I need to create an account?" (no, zero accounts anywhere) and "Is the data real-time?" (no, community snapshot model explained). Fixed a factual error: token storage was documented as `localStorage` but the implementation uses `sessionStorage` with a 30-minute TTL.
- **Watch Mode wording.** Tour step and dock button title replace "real time" with "polls GitHub every 60 seconds" for accuracy.
- **Landing one-liner.** A three-step summary added below the community count: "1. Paste a repo · 2. We scan GitHub · 3. Everyone sees the map".
- **Header / floating nav.** Token button label changed from "Add token" to "Faster scans" when no token is set.
- **Privacy page.** sessionStorage token storage and 30-minute TTL documented in the cookies/storage section.

---

## [0.5.4] (2026-05-27)

### Performance

- **Core Web Vitals: CLS pass on all pages.** Full audit of landing, map, profile, and explore pages. Six targeted fixes.
  - `AnnouncementBanner` now renders visible by default and hides via `useEffect` if previously dismissed. Eliminates the ~40px layout shift on first visit that was pushing CLS to 0.164.
  - `TopPanel` `locationCount` wrapped in `useMemo([points])` and component wrapped in `React.memo`. Stops an O(n) country normalization loop from running on each keystroke in the "Find a stargazer" input.
  - Unmapped users drawer virtualized using scroll-based windowing with `ResizeObserver` column detection. Pre-sort moved to `useMemo`. Opening the drawer on a repo with 30k+ unmapped users no longer blocks the main thread for 2-5 seconds.
  - Profile page map container now always rendered (height 0 when no coords) instead of conditionally mounted. Eliminates the 256px layout shift (CLS 0.931) on partial profiles (repo owners without a geocodable location).
  - Profile page GitHub repos section now has a correctly-sized skeleton during the async fetch window, and the section skeleton is positioned after `NewsTimeline` to match the loaded DOM order. Prevents two separate insertion-based layout shifts.
  - Explore page `UserListSkeleton` now renders `PAGE_SIZE` rows (30) with a matching pagination placeholder instead of 8 rows. On the mobile flex-col layout the left panel was growing from ~500px to ~1600px when data loaded, shifting the map column. CLS dropped from 0.179 to 0.001.
  - `NewsTimeline` loading skeleton reduced from 2 × h-12 (104px) to a single h-10 row. For profiles with no news the old skeleton collapsed to a 38px empty-state text, causing a 66px layout shift.

---

## [0.5.3] (2026-05-27)

### Features

- **Guided tour.** Five-page contextual tour (landing, map, explore, feeds, profile) with step-by-step overlay tooltips, keyboard navigation (arrow keys + Esc), and persistent completion state in localStorage. A TourTrigger button on each page lets users restart the tour at any time.

### Bug Fixes

- **`setViewMode` stale closure.** The function closed over the local `map` variable from `initMap` which could be destroyed after unmount or unset before layers were added. Switched to `mapRef.current` + `hasInitializedRef` guard to prevent null-pointer errors on fast navigation.
- **Scripts backfill `--force` flag.** `backfill-organic-score` now accepts `--force` to recompute already-scored rows, useful after signal weight changes or calibration updates. `db-sync-to-neon` expands the `badge_cache` upsert to preserve nullable columns during sync.

### Internal

- **SEO/GEO pass.** `robots.ts` adds `Bingbot`, `msnbot`, `Google-Extended` explicitly. `layout.tsx` `SoftwareApplication` description rewritten value-first; `dateModified` added; `speakable` cssSelector extended. FAQ gains 5 new Q&As targeting high-GEO queries (fake star detection, Watch Mode, Geographic Velocity, influential stargazers, multi-repo compare). `</script>` injection escaping (`<`) applied consistently to all inline JSON-LD scripts. Sitemap adds `/organic-score/calibration` and `/sponsor`.
- **Anti-AI text cleanup.** Em dashes removed from all user-visible strings across 30 files (landing, map, profile, trending, FAQ, privacy).
- **API parallelization.** `badge-update` runs plausibility and organic score checks in parallel. `/devs` count and top-countries queries use language materialized views. Nearby users and city queries use `Promise.all`. `badge-update` city scan timeout guard added.
- **Geocoder logging.** `recordSuccess()` added, Jawg/Geoapify HTTP status logged on error for faster diagnosis. Sitemap response cached for 1 hour.

---

## [0.5.2] (2026-05-25)

### Features

- **Follower filter: 1k+ and 5k+ tiers.** Two new levels above the existing 500+ threshold: `vhigh` (1k+, red dot) and `elite` (5k+, purple dot). The 500+ tier becomes orange. Applied consistently across the filter dock, timelapse, and share modal URL state.
- **Scan attribution.** When a user saves a scan with their own GitHub PAT, the scan is now attributed to their GitHub login. A new `indexedBy` column on `StargazerCache` stores the resolved login server-side. `useScanController` forwards the stored token as `x-gh-token`; the cache route resolves it via `GET /user` with a 3-second timeout and stores the result silently. `pnpm stats:views` gained a scan history panel showing the last 5 scans per repo with date, star count, and attribution.
- **GitHub star nudge.** A small card in the bottom-right corner appears after 2 minutes of navigation, linking to the GitHub repo. Shows once per browser (dismissed to `localStorage`), does not interrupt any flow.

### Performance

- **Vercel Runtime Cache L0 on geocoder.** An in-memory cache layer added before the Neon GeoCache lookup. Repeated location strings within the same function invocation resolve instantly without hitting the DB.

### Bug Fixes

- **Trending map: ISR payload overflow.** `fetchTrendingMap` removed from `use cache` scope after producing a 24 MB ISR fallback that exceeded Vercel's 19 MB limit. Endpoint switched to `force-dynamic`, result set capped at 30k points.
- **`cacheComponents` compatibility.** Dynamic Server Components (nonce injection, theme init script) wrapped in `<Suspense>` so the outer layout shell can prerender statically. Route segment `export const dynamic` configs removed from pages already covered by the global `cacheComponents: true` setting.

### Internal

- `src/middleware.ts` renamed to `src/proxy.ts` (Next.js 16 reserves `middleware.ts` for Vercel Routing Middleware; the StarMapper request proxy now lives under its correct name).
- ESLint and TypeScript errors introduced during the `use cache` migration resolved.

---

## [0.5.1] — 2026-05-24

### Performance

- **`use cache` migration (Next.js 16 PPR)** — `cacheComponents: true` enabled in `next.config.ts`. All data-fetching pages migrated from `export const revalidate = N` (time-based) to `'use cache'` + `cacheTag` + `cacheLife` (tag-based, on-demand). Cache invalidation is now surgical: `POST /api/badge-update` invalidates only the affected repo, the cron MV refresh invalidates `trending` and `explore-mvs`, `POST /api/news` invalidates the author's feed. Three shared query libs extracted (`repos-query.ts`, `trending-query.ts`, `devs-query.ts`) so pages and API routes share the same cached functions.
- **Self-call anti-pattern removed** — Five pages (`/`, `/repos`, `/trending`, `/devs/atlas`, `/devs`) were making HTTP `fetch` requests to their own API routes (e.g., `fetch("http://localhost:3000/api/trending/repos")`). All five now call the DB lib directly, eliminating the unnecessary loopback latency.
- **Server-side fetch on 4 pages** — `/repos`, `/trending`, `/devs`, `/devs/atlas` migrated from `useEffect` waterfall fetch to async server components with `initialData` prop. Data is available on first paint with no client-side loading state.
- **`force-static` on 9 content pages** — Static informational pages (`/about`, `/privacy`, `/terms`, `/oss`, etc.) marked `force-static` so they are prerendered at build time and served from the CDN edge with no runtime cost.
- **Hero globe: 7 map modals lazy-loaded** — `StatsModal`, `ShareModal`, `AllStargazersModal`, `GrowthModal`, `BadgeModal`, `RateLimitedModal`, `RepoNotFoundModal` are now `dynamic()` imports. Reduces initial JS bundle parsed on page load.

### Bug Fixes

- **Globe: per-segment hemisphere clipping** — Large landmasses (US, Europe, Africa) were disappearing abruptly when their ring centroid rotated past the orthographic terminator. Root cause: the renderer decided visibility at the ring level, so a polygon with any point on the back hemisphere was dropped entirely. Replaced with per-segment clipping: for each edge crossing the terminator, the exact boundary point is interpolated in geographic coordinates (`t = zA/(zA-zB)`) and used as the clip point. Continents now fade out gradually at the globe edge. Fast paths retained for rings fully in front or fully behind.

### Internal

- **`resolveBaseUrl` helper** — Extracted from inline page logic into `src/lib/resolve-base-url.ts`. Removed in subsequent refactor once the self-call pattern was eliminated.
- **GitHub star button** — Star count badge added to the header.
- **DB storage limit** — `DB_STORAGE_LIMIT_MB` env var removed; hardcoded to 100 GB to match Neon sponsored plan. Removes an unnecessary configuration surface.
- **Test fixes** — `repos` route mock aligned to `$queryRaw` (was `badgeCache.findMany`). `Ratelimit` stub fixed for TS2556 spread `unknown[]`.

---

## [0.5.0] — 2026-05-19

### Features

- **Environment validation** — `src/env.ts` added via `@t3-oss/env-nextjs`. Build fails at compile time and server startup if `DATABASE_URL`, `GITHUB_TOKEN`, or `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` are missing. Prevents silent misconfiguration on new deployments (closes #5).
- **Trending: split endpoints** — `GET /api/trending/repos` and `GET /api/trending/map` replace the monolithic `GET /api/trending`. The repos list now renders before the map because the two fetches are independent. Map endpoint decompresses the top 5 repos (was 10), halving CPU work per request. `/trending` loading skeleton added via `loading.tsx`. Legacy route kept as alias for one cycle.

### Security

- **CSP `style-src` hardening** — Broad `style-src 'unsafe-inline'` replaced with CSP Level 3 split: `style-src-elem 'self' 'nonce-{nonce}'` (blocks `<style>` injection) and `style-src-attr 'unsafe-inline'` (scoped to element attributes only, required by React dynamic styles and MapLibre controls). Closes #56.
- **CI: SHA-pinned GitHub Actions** — All three workflows (`ci.yml`, `audit.yml`, `semgrep.yml`) now reference actions by full commit hash instead of mutable version tags. Eliminates supply-chain risk from tag mutation. Closes #55.
- **CI: monthly link checker** — New `link-check.yml` workflow runs `lychee` monthly against `starmapper.bruniaux.com`, catching dead links and 404 regressions automatically.

### Performance

- **`page.tsx` split: 2668 → 700 lines** — `src/app/[owner]/[repo]/page.tsx` refactored across 12 commits. Extracted components: `StatsModal`, `ShareModal`, `AllStargazersModal`, `GrowthModal`, `BadgeModal`, `RateLimitOverlay`, `PreScanOverlay`, `RateLimitedModal`, `RepoNotFoundModal`, `GrowthChart`. Extracted hooks: `useScanController`, `useRepoCacheLoader`, `useCompareScan`, `useWatchMode`, `useTimelapse`. Each extraction ships with its own unit tests.

### Bug Fixes

- **Light mode palette** — Cold blue-gray tones replaced with warm cream (`#faf6ed` background, orange accent) across all light-mode CSS tokens in `globals.css`. Hero globe adapts to the active theme.
- **WebGL error boundary** — `StargazerMap`, `CountryChoropleth`, and `LanguageChoropleth` now render a fallback message instead of crashing when WebGL is unavailable (headless environments, some enterprise proxies).
- **Stale state on navigation** — `AbortController` added to 7 async fetch effects in the map page (repo-info, stats, organic-score, compare-info, growth-data, geo-velocity, stargazer-cache check). Prevents state updates on an unmounted component when the user navigates mid-scan. `useCompareScan` threads `AbortSignal` into each `/api/chunk` fetch. Closes #47.
- **Mobile profile layout** — Profile page (`/profile/[login]`) columns stack vertically on mobile (`flex-col lg:flex-row`). Action buttons (GitHub, Refresh, LinkedIn, Contact) are icon-only on mobile. Contact dropdown becomes a bottom-sheet. New reusable `src/components/ui/tabs.tsx` component.
- **Mobile Explore tabs** — Snap-scroll enabled on the Explore tab bar (`snap-x snap-mandatory`).
- **`vs/star-history` comparison table** — Replaced with stacked cards on mobile screens.
- **OG image errors surfaced** — Unhandled errors in `opengraph-image.tsx` are now caught and rendered as a text fallback instead of silently failing. Closes #49.
- **Vitals route: structured logging** — `POST /api/vitals` logs structured JSON instead of a raw string; React list-key instability in Explore fixed. Closes #57, #58.
- **`postinstall` prisma generate** — `package.json` now runs `prisma generate` on every `pnpm install`. Fixes the case where pnpm reorganizes the virtual store and wipes the generated `.prisma/client` artifacts.

### Internal

- **Tests** — jsdom + React Testing Library added to the Vitest setup. 14 component smoke tests for `ThemeToggle` and `TokenModal`. 19 new tests for trending endpoints. 16 smoke tests for extracted map components. 8 tests for `useRepoCacheLoader`, 4 for `useCompareScan`. Total: 856 → 872 tests.
- **`src/lib/repo-cache.ts`** — `LocalCache` helpers (`loadCache`, `saveCache`, `clearCache`, `cacheKey`) centralized from inline `page.tsx` definitions into a shared lib. Two sequential `useEffect` that both called `loadCache` merged into one, removing a duplicate `localStorage` read on every page load.
- **`prisma/sql/schema-baseline.sql`** — Full SQL snapshot generated via `prisma migrate diff --from-empty`. Combined with `prisma/sql/views.sql`, gives contributors a complete DB picture without enabling migration history. Closes #53.
- **`design-system/` removed** — Stale auto-generated spec (`MASTER.md`, 209 lines) removed; `globals.css` documented as the single source of truth for tokens. Closes #54.
- **`exhaustive-deps` lint rule enabled** — `react-hooks/exhaustive-deps` flipped from `off` to `warn`. 5 pre-existing intentional violations suppressed with inline comments explaining the rationale. Closes #48.
- **Deps** — tailwindcss, `@upstash/redis`, `eslint-plugin-react-hooks`, `@types/node`, `tsx` bumped.
- **Claude rules** — 10 new `.claude/rules/` files ported/adapted from methode-aristote: `response-discipline`, `git-merge-discipline`, `react-performance-optimization`, `react-timers-cleanup`, `typescript-zero-errors`, `session-management`, `scripts-best-practices`, `file-organization`, `universal-rules`, `known-gotchas`. CLAUDE.md slimmed from ~800 to 146 lines.

---

## [0.4.9] — 2026-05-17

### Features

- **Landing redesign** — Hero split layout: input form on the left, live map preview on the right. Hero background replaced with an animated 3D canvas globe. New accent palette (cooler blues, sharper contrast). `/faq` dedicated page replaces the inline FAQ section; a compact teaser remains on the landing with a "See all" link.
- **Jawg dual-token failover** — `fetchAndPatchStyle` auto-switches to `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2` when the primary token returns 401/402/403/429 (Map Views limit). Transparent to users, no reload required.
- **Geocoder: promise queue** — Sequential Nominatim calls now use a shared promise queue instead of a sleep-in-loop. Correct rate limiting without blocking the event loop; circuit breaker logic preserved.
- **localStorage scan cache utility** — `src/lib/scan-cache.ts` added (preparatory, not yet wired into the chunk loop). Persists scan results between page reloads for returning visitors.

### SEO / GEO

- **Trending page** — `/trending` added to sitemap and navigation.
- **Comparison page** — `/vs/star-history` with structured data and UTM tracking on outbound badge/embed links.
- **Schema markup** — Extended structured data across map, profile, and language pages. GEO optimization pass: `description`, `og:*`, `twitter:*` fixed on all pages.
- **Server/client split on language pages** — H1 and dev count now rendered server-side for crawlers.

### Security

- **Phase 2 — rate limit hardening** — Sliding window tightened on sensitive endpoints; Redis unavailability handled safely.
- **Phase 3 — defense in depth** — `$executeRawUnsafe` replaced with `$executeRaw + Prisma.sql` on all MV refresh paths. Admin endpoints return 404 (not 401/403) on auth failure to avoid endpoint discovery.

### Performance

- **`/repos` page** — Replaced `useEffect + useState` fetch with `useSWR`; stale-while-revalidate reduces perceived latency.
- **`/api/map-image`** — `stargazer_cache` SELECT restricted to `points` only (was fetching the full row including `unmapped`).
- **Profile lookup** — `ILIKE` search on `login` replaced with an `IN` clause to avoid a full table scan.

### Bug Fixes

- **`/repos` sort** — Fetches all repos before sorting client-side; previous version only sorted the first page.
- **Header alignment** — Content width unified to `max-w-7xl` across all pages.
- **Profile URL casing** — `FlorianBruniaux` (camelCase) used consistently in profile and badge URLs.
- **Profile duplicates** — When `github_user` has multiple casing variants for the same login, the record with the most data is selected instead of throwing.
- **Globe on profile pages** — Map centers on the user's own coordinates on load.

### Internal

- **Tests** — 9 new test files added (user cache integration, background persistence, chunk route). Line coverage 79% → 87%.
- **lucide-react** — Inline SVGs replaced across all components.
- **CI** — Node.js 20 → 22 (required by pnpm 11); `pnpm/action-setup` reads `packageManager` from `package.json` instead of hardcoded version. Semgrep false positives on JSON-LD suppressed.
- **Deps** — Prisma 7.8, MapLibre GL 5.24, Zod 4.4, web-vitals 5.
- **Repo hygiene** — `graphify-out/` untracked (328 files, 5.8MB of generated cache removed from git history going forward). `.gitignore` extended with `.pnpm-store/`, `.codex/`, `.code-review-graph/`.

---

## [0.4.8] — 2026-05-12

### Features

- **Star growth timeline** — "Growth" button in the Dock opens a weekly bar chart of star accumulation over time. Data comes from `star_event.starredAt` via `GET /api/stats/[owner]/[repo]/growth` (SQL `DATE_TRUNC('week')`, 5-min CDN cache). Falls back to in-memory `starredAt` timestamps for repos scanned in the current session. Button is now visible for any repo with scan data, not just scans that captured timestamps in memory.
- **Landing page — community maps diversity** — `/api/repos?diverse=true` mode: fetches a 500-row pool and filters to max 3 repos per owner + min 100 stars before returning results. Prevents a single active user from filling the entire grid.
- **Landing page — "More to explore" section** — 4-card grid below "How it works" linking to Explore, Developer profiles, Dev Maps, and Language Atlas. The surfaces were previously invisible to new visitors.
- **Landing page — copy + FAQ improvements** — "Shared cache" card renamed "Instant for everyone" with clearer copy. FAQ expanded from 7 to 10 questions (scan duration, token storage, open source). CTA label corrected from "Map It" to "Map Stargazers". Badge and data removal answers improved.

### Docs

- **PITCH.md rewrite** — Full structural rewrite from "what changed recently" (ordered by version) to "what it is" (organized by product surface: Repo Map, Stats panel, Developer profiles, Explore, Dev Maps + Atlas, Chrome Extension, Integrations & embeds). All 7 surfaces documented. Previously undocumented: heatmap, timelapse, compare, SVG map image embed, GeoJSON API, Trending page.

---

## [0.4.7] — 2026-05-12

### Features

- **Chrome Extension v1.1.0 — profile button** — On GitHub profile pages (`github.com/[login]`), a "★ StarMapper" button is injected in the user sidebar that opens `starmapper.bruniaux.com/profile/[login]`. Content script `matches` extended to `["https://github.com/*", "https://github.com/*/*"]` to cover single-segment paths. `getPageContext()` discriminated union (`repo | profile | other`) dispatches the correct button per page type. Profile button is full-width to match GitHub's sidebar style; injection targets `.js-profile-editable-area` then `Layout-sidebar` with a 2s floating fallback.

---

## [0.4.6] — 2026-05-12

### Features

- **Chrome Extension (Manifest V3)** — "★ Map" button injected on every GitHub `/owner/repo` page, opening the StarMapper map directly. Toolbar popup with the current repo + last 5 visited repos + search by slug or URL. Context menu on right-click for GitHub links. Handles GitHub SPA navigation (Turbo + bfcache) via `MutationObserver`. Dark/light compatible via GitHub CSS variables.

### Internal

- **Extension refactor: WXT migration** — Replaced Vite + `@crxjs/vite-plugin` v2 (stagnant beta) with WXT v0.20. `entrypoints/` structure (background.ts, content.ts, popup/), build → `.output/chrome-mv3/`, `wxt zip` for Chrome Web Store. Standalone `tsconfig.json` (without `extends: .wxt/tsconfig.json`) to avoid the Vite circular reference bug.
- **5 extension fixes** — `MutationObserver` replaces `setTimeout(120ms)` for button injection; `pageshow` handler + `e.persisted` for bfcache; recent repos saved to `chrome.storage.local` on click; `SYSTEM_OWNERS` blocklist in context menu (filters `/settings`, `/explore`, etc.); icons in `public/icons/` for WXT serving.
- **Full docs audit** — Updated `README.md` (Chrome Extension), `PITCH.md` + `PITCH-en.md` (Organic Score: 4 signals → 3, correct weights fork=40%/watcher=5%/zero-followers=55%; Watch mode, Geo velocity, Notable stargazers, Chrome Extension added), `docs/ARCHITECTURE.md` (version 0.4.6, Neon 100GB sponsored, +15 missing API routes, full file structure with schemas/ and extension/), `PROJECT_INDEX.md` + `llms.txt` (extension/ section), `docs/organic-score-calibration.md` (Final Decision corrected: fork=40%, non-fork=70%).
- **`docs/extension-publishing.md`** — Chrome Web Store guide: developer account, build/zip, upload process, updates, semver convention, profile button roadmap with prepared DOM selectors.
- **`tsconfig.json`** — `extension/` excluded from root compilation (WXT config is standalone in `extension/tsconfig.json`).

---

## [0.4.5] — 2026-05-11

### Features

- **Watch mode** — "Watch" button in the Dock (visible for scanned repos with timestamps). Activates GitHub polling every 60s: compares recent stargazers against the start timestamp, detects new stars without rescanning. Display: pulsing green dot + `+N ★ · India, Germany` in real time. Stops automatically after 10 min with no new star. Endpoint `GET /api/watch/[owner]/[repo]?since=<ISO>`: GitHub REST + `countryNormalized` lookup from `github_user` (no Nominatim calls). No DB writes, `Cache-Control: no-store`.

---

## [0.4.4] — 2026-05-11

### Features

- **Notable stargazers row** — The Stats modal now shows the top 5 stargazers by followers as avatar chips, visible on open without switching tabs. Each chip shows the avatar, login, and follower count. A "Top N →" link switches to the full Top Stars tab. Data is available immediately from the in-memory scanned points (no additional API call).
- **Geographic velocity ("📈 Rising")** — New tab in the Stats modal that reveals which countries are discovering the repo right now. Compares the daily pace of the last 30 days against the historical pace from days 31–90. Four statuses: `rising` (×1.5+), `new` (no history), `stable`, `declining` (≤0.5). Lazy loading: the request only fires when the tab is opened, once per session. Endpoint `GET /api/stats/[owner]/[repo]/geo-velocity`, SQL query with `COUNT(*) FILTER`, 5-min CDN cache.

---

## [0.4.3] — 2026-05-11

### Features

- **Deep link sharing** — The Share modal now shows a "Current view" section when filters are active (country, city, company, followers, date, tier, view mode). The filtered URL is copy-able in one click and encodes all active filters as query params. Loading a shared URL restores the filter state and shows a dismissible "Shared view" overlay listing the active filters.
- **Velocity indicator** — The Stats modal summary row shows `+N/mo` in green under the star count, computed from `starredAt` already in memory after a scan. Only appears when the data is present (recent scans with timestamps); silently absent for old caches.

### Internal

- **Zod body validation on all POST routes** — All 7 POST routes migrated to a `defineRoute(schema, handler)` wrapper. New `src/schemas/` directory holds typed Zod v4 schemas for each route (`track`, `vitals`, `recalculate-location`, `badge-update`, `chunk`, `news`, `stargazer-cache`). Per-field error codes are declared directly in schemas; `defineRoute` surfaces `issues[0].message` verbatim so every existing error contract is preserved unchanged. Manual `typeof` / regex validation chains removed from all route handlers. `getIP` exported from `api-helpers` to replace a duplicate helper in the chunk route.

---

## [0.4.2] — 2026-05-08

### Features

- **GitHub Repos section on profile pages** — `/profile/[login]` now shows the cached top repos grid (up to 8, from `topRepos` in DB). Count badge reflects the real `publicRepos` value from GitHub, not the cached repo list length.
- **Map a repo modal** — "Map a repo" button next to the repos count badge opens a full-repo picker: fetches all public repos from GitHub (up to 500), searchable by name/description, sortable by Stars or A–Z. Clicking any repo navigates directly to its StarMapper map.

### Bug Fixes

- **Explore — `@username` search** — Searching with a leading `@` (e.g. `@ruvnet`) now works the same as without. The prefix is stripped before debouncing to the search state.
- **Profile — stale `topRepos` after Refresh** — After a manual Refresh, `topReposFetchedAt` is reset so the next profile load re-fetches top repos from GitHub instead of serving the outdated cache.

---

## [0.4.1] — 2026-05-05

### Features

- **`/changelog` page** — Versioned timeline served from `CHANGELOG.md` at build time. Server Component with inline bold+code rendering without an external markdown dependency. Link added in the footer and in the announcement banner.

### Performance

- **Explore — O(N) timeout on dense bounding boxes** — High-density areas (Singapore, etc.) could return 12k+ users in the bounding box. The JOIN on `user_repo_count_mv` over 12k rows via Neon was exceeding the 10s statement timeout. Fixed by pushing the `lat IS NOT NULL` filter before the JOIN and capping candidates to 500 before enrichment.

### Bug Fixes

- **FollowButton — wider dropdown** — Width increased to `w-96` with more padding to prevent RSS/JSON URL wrapping.
- **FollowButton — minimal mode on the subscribe page** — On `/feed/[login]`, the dropdown was redundant (URLs already displayed). `minimal` prop added: direct toggle without dropdown.

---

## [0.4.0] — 2026-04-24

### Features

- **News & Announcements on profiles** — Developers can publish short announcements (max 280 chars, optional link) directly on their StarMapper profile. Authentication via GitHub PAT — the same token used for scanning repos. 24h sliding cooldown per author (soft-deleted posts included in the cooldown, anti-bypass). `NewsTimeline` component integrated on `/profile/[login]` with skeleton loader, conditional "Publish" button (visible only if the stored token matches the page login).
- **RSS 2.0 + JSON Feed 1.1 per developer** — Each profile exposes two subscribable feeds: `GET /api/feed/[login]/rss` (RSS 2.0 with `<atom:link>`, `If-Modified-Since`, 304 response) and `GET /api/feed/[login]/json` (JSON Feed 1.1). Cached 1h CDN. Subscribe link (RSS icon + "Subscribe") displayed at the top of the News section on the profile.
- **`/feed/[login]` page** — Dedicated subscription page: hero with avatar + identity, subscribe card with copyable RSS/JSON URLs, full list of announcements, back link to the map profile. Accessible via the "Subscribe" link on the profile or "View all" on the timeline.
- **`NewsPublishModal`** — Publish modal with char counter (280), optional URL field, display of copyable feed URLs post-publication. Error handling: remaining cooldown displayed in h/min, invalid token clearly indicated.
- **`verifyPat()` + Upstash cache** — GitHub PAT verification via the REST API, result cached in Upstash Redis. Raw token never stored. Graceful fallback if Redis is unavailable.
- **RSS subscriber tracking** — Every hit on `/api/feed/[login]/rss` is recorded in `page_view` (type `"feed_rss"`, slug = login). Queryable via `pnpm stats:views`.

### Security

- **Dynamic CSP nonces** — Per-request nonces on inline scripts, replacing static `unsafe-inline` in CSP.
- **POST route protection** — HMAC session verification on all POST routes.
- **Rate limit resilience** — Rate limits fail safely when the Redis backend is unavailable.
- **PAT cache hardening** — Token verification cache security hardened. Revocation window reduced.
- **News publish anti-race** — Concurrency handling improved on the news publish flow.

### Bug Fixes

- **TokenModal — unresolved username** — The modal was storing only the token, never the username. On pages other than the map (e.g. `/profile/[login]`), `getStoredUsername()` returned `""`, which set `isOwner` to `false` and hid the "Publish" button even for the profile owner. `handleSave` now resolves the login via `GET /api.github.com/user` and stores it. "Verifying…" shown during verification; `handleRemove` also clears the username.
- **Middleware** — Rate limiting now correctly covers routes with dynamic segments.
- **News cooldown** — Cooldown window now correctly includes deleted posts.
- **Organic score** — Feature flag enforcement added on the refresh endpoint.
- **Web Vitals** — Input validation strengthened on the vitals endpoint.

### Internal

- **`feed-builders.ts`** — Two pure functions: `buildRss20()` (RSS 2.0 XML, correct CDATA, `]]>` split into two CDATA sections) and `buildJsonFeed()` (JSON Feed 1.1 object). Build logic decoupled from routes for testability.
- **`isValidLogin()` / `normalizeLogin()`** — Helpers centralized in `github-auth.ts`, reused by all news and feed routes.

---

## [0.3.5] — 2026-04-24

### Features

- **Announcement banner** — Dismissible top banner on the home page to announce new features. Dismissal stored in localStorage by `BANNER_ID`; bump the ID to make it reappear for the next announcement. Home header switched to `sticky` to stack naturally below the banner.
- **banner-reminder hook** — `PostToolUse` hook that detects the creation of a new `page.tsx` or `route.ts` and reminds you to update `AnnouncementBanner`.

### Bug Fixes

- **Explore Map button** — The "Map" button was hidden (`opacity-0`) for users *with* coordinates, and visible (grey) for those *without*. Inverted: button always visible and clickable for geolocated users, `invisible` (space preserved) for others.
- **Countries counter = 0** — `country_stats_mv` was created empty (no `countryNormalized` at creation time), then never refreshed after the backfill. Added `create:country-stats-mv` / `create:country-stats-mv:prod` commands to create and refresh the MV.
- **Repo column tooltips** — Tooltips on sortable column headers were hidden behind the search bar. Positioning fixed.

### Internal

- **`starmapper-update.sh` script** — Meta-script that chains all backfills in sequence (`repo-metrics` + `repo-languages`). Commands: `update:prod`, `update:local`, `update:local:force`.
- **`backfill:repo-metrics:local` / `:local:force` scripts** — Local (Docker) variants of the repo-metrics backfill with `DATABASE_DRIVER=standard`.

---

## [0.3.4] — 2026-04-22

### Features

- **Organic Score** — "Organic" popularity score per repo (0–100), computed from activity signals independent of stars: forks, zero-dependency forks, watchers, open issues, open PRs. Weights: ZF 55% / forks 40% / watchers 5%. Score displayed via `OrganicScorePill` fetched independently from the rest of the page.
- **Organic score column in repos list** — Sortable column on the landing page, color-coded by tier (🟢 great / 🟡 good / 🟠 moderate / ⚫ low), with a detail modal on click (signal breakdown + StarScout comparison).
- **`openPRsCount` in `BadgeCache`** — Separation of issues / PRs in the model (previously: mixed `openIssuesCount` field). Organic score modal displays both badges separately and as clickable links (GitHub links).
- **Organic score calibration** — Debug tool to compare scores on a real sample (local dev only).

### Bug Fixes

- **Neon timeout** — `stats/[owner]/[repo]` was throwing a Neon timeout on large tables. Graceful fallback: returns the partial data available without crashing.
- **Prod backfill** — `backfill-repo-metrics.ts` was using `DATABASE_URL_LOCAL` instead of `DATABASE_URL` for `:prod` commands. Fixed + `NEXT_PUBLIC_ORGANIC_SCORE_ENABLED=true` forced.

### Internal

- **Weight rebalancing** — Two calibration passes: watcher 10%→5%, fork 70%→40%, zero-fork 25%→55%. More discriminating results on real repos.
- **Methodology docs** — `docs/organic-score.md`: StarScout vs StarMapper comparison, normalization formula, known limitations.

---

## [0.3.3] — 2026-04-16

### Features

- **Developer profile page** — `/profile/[login]`: two-column layout (scrollable panel 2/3 + sticky map 1/3). Data: bio, followers, repos, languages, tracked star events, contribution by country. Partial profile if user is absent from DB (refresh triggered automatically).
- **Profile entry points** — Click on avatar/login in map popups, in `explore/top`, `explore/power`, `explore/nearby`. "View StarMapper profile →" button in the stargazer popup.
- **Profile: nearby developers** — "Nearby developers" section on the profile page: list + pins on the map for geolocated devs within Xkm.
- **Profile: contact dropdown** — Dropdown menu with LinkedIn (obfuscated), email (obfuscated), GitHub links — protected against scraping.
- **Profile: view tracking** — `POST /api/track` triggered on load; daily view counter per profile in `page_view`.
- **GeoJSON API gated** — `GET /api/geo/[owner]/[repo]`: aggregated endpoint returning GeoJSON points from a scan, protected by HMAC API key. Usable by third-party tools.
- **Timelapse** — Replay the star acquisition history by month/week with a speed selector. Based on `star_event.starredAt`.

### Performance

- **Core Web Vitals audit** — Multiple passes: `startTransition` around chunk loop dispatches, `useDeferredValue` on the stargazers filter, `useCallback` on map handlers, gating of expensive memos, lazy-load `TokenModal` + `SponsorsBlock`, `width/height` on avatars (CLS).
- **ETag + CDN** — Two-step ETag on `stargazer-cache`, optimized CDN TTL, redundant login index removed.
- **GeoJSON in throttled window** — GeoJSON computed inside the throttled `setData` window to avoid blocked frames.

### Internal

- **`CircuitBreaker` class** — Extracted into a reusable class. Unit tests added.
- **Cache refactor** — Compression utilities centralized.
- **Pre-open-source hardening** — Secrets audit, hardened `.gitignore`.

---

## [0.3.2] — 2026-04-14

### Performance

- **Neon DB optimizations** — `db:sync:from-neon`: `--repo`, `--limit`, `--tables` variants for partial sync. `SET statement_timeout=0` added at the top of all DDL scripts (indexes + MVs). Prisma slow query logger enabled.
- **Additional MVs** — `user_repo_count_mv` (per-user repo count, nearby query 6s→200ms). GIN trigram index on `login` + `name` (ILIKE search 6s→50ms).

### Internal

- **Tests** — CircuitBreaker suite added. Fixed stubs that were silently passing.
- **SEO / a11y / perf audit** — Robots, sitemap, structured data, focus management, aria labels, bundle size.
- **Security** — Pre-open-source hardening.

---

## [0.3.1] — 2026-04-13

### Bug Fixes

- **Fix Jawg auth** — `callJawg()` in `geocoder.ts` was sending the token only via the `x-api-key` header. Added the `access-token` query param required by the dedicated `starmapper.jawg.io` endpoint. Without this param, Jawg requests silently returned 401.
- **Fix geocode explore label** — `/api/explore/geocode` was manually reconstructing the label using `p.city` (a field that does not exist in the Jawg Places model). Replaced with `feature.properties.label`, which Jawg provides natively.
- **Fix geocoder tests** — `geocoder.test.ts` was stubbing `JAWGMAP_ACCESS_TOKEN` while the code reads `JAWG_TOKEN_HEADER`. 7 pre-existing tests were silently failing. Fixed.
- **Docs** — Replaced all occurrences of "Pelias" with "Jawg Places" in `README.md` and `docs/ARCHITECTURE.md`. Jawg Places is based on Pelias but the correct brand name is Jawg Places.

### Internal

- **`fetchAndPatchStyle` consolidation** — The function existed twice: an inline version in `stargazer-map.tsx` (30 lines, no cache) and a version in `lib/map-style.ts` (with cache). `lib/map-style.ts` is now the single source of truth. The function accepts a `projection` parameter (`"mercator"` | `"globe"`, default `"mercator"`) with a composite cache key `${url}#${projection}` to avoid globe/mercator collisions.
- **Removed obsolete style patches** — `lang=en` removed from style URLs in `theme.ts` and `stargazer-map.tsx` (Jawg handles language natively). Glyphs URL patch removed (`lib/map-style.ts`, `stargazer-map.tsx`). `name:fr → name:en` replacement removed (`map-style.ts`, `stargazer-map.tsx`).
- **`batch-scan.ts` migration** — Geocoding endpoint migrated from `api.jawg.io` to `starmapper.jawg.io` (dedicated StarMapper endpoint). Token migrated from `JAWGMAP_ACCESS_TOKEN` to `JAWG_TOKEN_HEADER`. Added `x-api-key` header.
- **CLI scripts refactor** — The 10 scripts in `scripts/` now use `node:util parseArgs` with `strict: true` instead of ad-hoc `process.argv.includes` / `getArg` patterns. `parseArgs` is native Node 18+, no dependency.

---

## [0.3.0] — 2026-04-10

### Features

- **Language Atlas** — `/devs/atlas` page: world choropleth map showing the most popular language per country, computed from starred and contributed repos. Country detail on click (dominant language, %, number of devs). "Early preview" banner while the backfill runs.
- **Dev Maps by language** — `/devs` and `/devs/[language]` pages: developer map filtered by language, with a selection combobox.
- **Languages backfill** — `backfill-languages.ts` script to populate the `languages[]` field on `github_user`. `--from-cache` mode: derives languages from `star_event + badge_cache` with no GitHub API call (1.23M users in seconds). API mode: parallelizable via `--token-index`.
- **`country_language_stats_mv` materialized view** — (country × language) aggregation for the Atlas. Created/refreshed automatically by `pnpm db:sync` and the daily admin cron.

### Performance

- **Backfill 3× faster** — `maxRepositories: 30 → 10` (fewer GraphQL points consumed), default batch `10 → 50`, bulk UPDATE via `unnest()` (1 SQL query instead of N individual ones).

### Bug Fixes

- **db:sync** — `github_user` was going from `DO NOTHING` to `DO UPDATE`: the `languages` and `languagesFetchedAt` columns were never being pushed to Neon. Fixed.
- **db:sync** — Automatic creation of `country_language_stats_mv` on Neon during sync if it does not yet exist.

### Internal

- **`LANGUAGE_COLORS`** — Map of 24 languages to distinctive colors in `src/lib/language-colors.ts`.
- **`LanguageChoropleth`** — MapLibre choropleth component (dynamic import `ssr: false`).
- **Atlas copy** — Wording "gravitate toward" and "favor" rather than "use" / "dominant" (data = affinity, not certified practice).

---

## [0.2.0] — 2026-03-31

### Security

- **HMAC session token** — HttpOnly session cookie issued on each page load, verified on sensitive endpoints.
- **Distributed rate limiting** — Per-IP Redis sliding windows replacing per-instance in-memory counters. Survives serverless scaling. Tiers per endpoint sensitivity.
- **Referer + origin verification** — All sensitive endpoints validate request origin.
- **Stargazer-cache write protection** — Freshness and plausibility checks on cache writes.
- **XSS fix** — Map popup switched from `innerHTML` to DOM API construction.
- **CSP hardening** — `unsafe-eval` removed in production. HSTS added.
- **Input validation** — Character filtering on search parameters in the Explore tab.
- **Error sanitization** — Credentials stripped from server logs before they reach Vercel dashboard.
- **Coordinate precision** — API responses return rounded coordinates (~1km). Full precision stays in DB.
- **Semgrep SAST CI** — Automated OWASP/secrets scan on push and weekly.

### Features

- **Find me** — GitHub username saved in localStorage. First use: inline prompt. Subsequent visits: one click to fly to your own pin on the map.
- **Badge button sidebar** — "Badge" button in the sidebar (between History and Share) → mini-modal with live preview, selectable Markdown code, "Copy" button with feedback.
- **Badge in Share modal** — "README badge" section at the bottom of the Share panel.
- **Explore 2-column layout** — Leaderboard tabs (left) + sticky map (right), always visible. Max width increased to `max-w-7xl`.
- **Owner repos list search + sort** — Filter by name/description, 4 sort modes (stars desc/asc, A–Z, Z–A).
- **Stats panel: publicRepos sort** — Top users sortable by followers or public repos. CSV export behind env flag.
- **Token required for rescan** — Full rescan and delta refresh now require a GitHub token (lock icon displayed).
- **Landing footer** — "by Florian Bruniaux" and "Follow" pill buttons with portfolio/GitHub links.
- **Community maps pagination** — Paginated table (20 rows/page) with Prev/Next buttons. API limit increased from 50 to 200 repos.

### Performance

- **Client-side gzip compression** — Scan data compressed client-side (Web CompressionStream, gzip+base64) before `POST /api/stargazer-cache`. Fixes silent cache loss on repos with >~15k stars (raw payload ~15MB > Vercel 4.5MB limit). Payload reduced to ~800KB.
- **GeoNames geocache** — Pre-seeding with ~51k entries (cities pop >15k + countries + ISO2/ISO3 codes). >99% hit rate on real scans.
- **Geocache cleanup** — 36 garbage entries deleted (#hashtags, $shell variables, `[object Object]`, XSS artifacts, Jinja templates).
- **DB portability** — Conditional adapter in `db.ts`: `DATABASE_DRIVER=standard` → `@prisma/adapter-pg` (Docker, Railway, Supabase); default → `@prisma/adapter-neon`. Self-hosting without Neon works.
- **DB optimizations** — Indexes added on hot query paths, result caps (`take: 10_000`), TTL-aware health guard.

### Bug Fixes

- **Antimeridian bug** — Russia and other countries crossing the 180° meridian caused a triangle artifact on the choropleth map. Fix: polygon ring normalization so no adjacent vertices differ by more than 180° in longitude.
- **MapLibre Web Worker CSP** — Added `worker-src blob:` (was blocking the MapLibre web worker → blank map on some configs).
- **React hydration** — `localStorage` access during SSR render caused React error #418. Fix: state initialized SSR-safe, synced via `useEffect`.
- **Pre-scan modal race condition** — The pre-scan modal briefly appeared on already-indexed repos. Fix: `cacheCheckDone` state.
- **Geocoder** — `isGeocodeableLocation` filter extended to prefixes `#$<>[{"!`.

### Internal

- **AGPL-3.0-only license** — SPDX headers on 50 source files, NOTICE file.
- **API refactoring** — Shared libs: `api-validation.ts`, `api-helpers.ts`, `compression.ts`, `compress-client.ts`. Replaced 10 duplicated patterns across 15 route handlers.
- **Code conventions** — API routes converted to const arrow functions. `interface` → `type`. `import type` for type-only imports.
- **Scripts** — `batch-scan.ts`: incremental FLUSH_EVERY writes, session-level geocoding cache, better error recovery.
- **Dependabot** — Weekly dependency updates on main.
- **Prisma 7.5 → 7.6** — Fixes 12 vulnerabilities (3 high, 8 moderate, 1 low) in the transitive dev dependency chain.

---

## [0.1.0] — 2026-03-26

Initial public release.

### Features

- **Dark / light mode**: Toggle in the header with full CSS token migration.
- **Collapsible mobile sidebar**: Left sidebar on the map page is collapsible on mobile, with a visible close button.
- **Landing page redesign**: Two-column layout (form + community maps table), colorful feature highlights, FAQ.
- **Community maps table**: Table of already-scanned repos on the landing page, sorted by scan date, with Stars / Mapped% / Countries / Last scan columns.
- **Followers filter**: Slider to filter stargazers by follower count from the map control bar.
- **Country and city filters**: Filtering combobox in the stargazers table.
- **LinkedIn sharing**: Pre-share panel with editable text and clipboard copy.
- **SVG badge**: `/api/badge/[owner]/[repo]` — shield with mapped count and country count, 6h CDN cache.
- **Image / Markdown export**: From the scan stats.
- **SEO / GEO**: `robots.txt`, `sitemap.xml`, structured FAQ, Open Graph metadata.
- **Explore page**: `/explore` listing mapped repos with stats.

### Performance

- **Stargazer cache**: Shared cache of complete scans (`stargazer_cache` table) — instant reload for subsequent visitors on the same repo. Limit: 100k stars.
- **Gzip compression**: Stargazer cache data is compressed (gzip+base64), reducing payload size by ~70%.
- **Skip cached users**: The chunk endpoint does not re-write to DB users already present and unchanged.
- **Geocache "not found"**: Locations that fail to geocode are cached with `lat=null/lng=null` — avoids repeated API calls for the same garbage input.
- **Geoapify geocoding**: Added Geoapify as fallback 2 (between Jawg and Nominatim), with circuit breaker.
- **Invalid location filter**: `isGeocodeableLocation()` filters TLDs, phone prefixes, URLs, placeholder values before any API call.

### Architecture

- **Client-side chunk loop**: The browser orchestrates `POST /api/chunk` calls (100 users/call) to stay under the Vercel 10s timeout.
- **Shared geocache**: `geocache` Neon table shared across all repos — a location geocoded once benefits all future scans.
- **3-tier geocoding**: Jawg (primary, circuit breaker) → Geoapify (fallback 1, circuit breaker) → Nominatim (final fallback, 1100ms/req).
- **User-level cache**: `github_user` + `star_event` tables to track users and their repos at the user level.
- **Token modal**: Users can provide their own GitHub PAT for repos with >6k stars (unauthenticated limit).
