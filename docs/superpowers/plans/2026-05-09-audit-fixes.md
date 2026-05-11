# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITICAL and HIGH issues from `claudedocs/audit-full-2026-05-09.md` across backend, design system, and frontend performance.

**Architecture:** Four independent groups executed in parallel worktrees. Each group owns a distinct set of files with no conflicts.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4 @theme, Upstash Redis (Ratelimit + Redis), Prisma 7 + Neon adapter, MapLibre GL 5.x.

---

## Parallelisation map

| Group | Scope | Files touched |
|-------|-------|---------------|
| A — Backend | API routes, DB, rate limits | `api/track/route.ts`, `admin/refresh-grid-mv/route.ts`, `api/stargazer-cache/route.ts`, `api/stargazer-cache/[owner]/[repo]/route.ts` |
| B — Design tokens | Orange palette, badge contrast, docs | `announcement-banner.tsx`, `organic-score-pill.tsx`, `repo-table.tsx`, `organic-score-modal.tsx`, `organic-score/calibration/page.tsx`, `docs/design-system.md`, `globals.css` |
| C — Frontend perf | world-atlas public asset, choropleth | `country-choropleth.tsx`, `language-choropleth.tsx`, `public/world-110m.json` (new) |
| D — Console cleanup | devs pages | `devs/[language]/page.tsx`, `devs/atlas/page.tsx`, `devs/page.tsx` |

Phase 2 (after merge): page monolith extraction, Button component, modal unification.

---

## GROUP A — Backend fixes

### Task A1: Rate-limit `/api/track`

**Files:**
- Modify: `src/app/api/track/route.ts`

Current state: No auth, no rate limit. `POST /api/track` accepts any slug and creates unbounded PageView rows.

Pattern to follow: `src/app/api/geo/[owner]/[repo]/route.ts` (Upstash Ratelimit.slidingWindow).

- [ ] **A1.1 — Add Upstash rate limit (60 req/min/IP)**

Replace the full file content:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";

const VALID_TYPES = new Set(["repo", "profile", "feed_rss"]);

const SLUG_RE: Record<string, RegExp> = {
  repo: /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/,
  profile: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
  feed_rss: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
};

let _limiter: Ratelimit | null = null;
const getLimiter = (): Ratelimit | null => {
  if (_limiter) return _limiter;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  _limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "rl:track",
  });
  return _limiter;
};

const getIP = (req: NextRequest): string =>
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

export const POST = async (req: NextRequest) => {
  const limiter = getLimiter();
  if (limiter) {
    const { success } = await limiter.limit(getIP(req));
    if (!success) return NextResponse.json({ ok: true }); // silent — analytics endpoint
  }

  try {
    const body = await req.json() as { type?: unknown; slug?: unknown };
    const { type, slug } = body;

    if (typeof type !== "string" || !VALID_TYPES.has(type)) {
      return jsonError("invalid_params", 400);
    }
    if (typeof slug !== "string" || !SLUG_RE[type]?.test(slug)) {
      return jsonError("invalid_params", 400);
    }

    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    await prisma.pageView.upsert({
      where: { type_slug_date: { type, slug, date } },
      create: { type, slug, date, count: 1 },
      update: { count: { increment: 1 } },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
};
```

- [ ] **A1.2 — Verify TypeScript**
```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **A1.3 — Commit**
```bash
git add src/app/api/track/route.ts
git commit -m "fix(api): add rate limit to /api/track (60 req/min/IP)"
```

---

### Task A2: Sequential MV refresh

**Files:**
- Modify: `src/app/api/admin/refresh-grid-mv/route.ts`

Current state: `Promise.all([7 REFRESH MATERIALIZED VIEW CONCURRENTLY])` — parallel execution risks pool exhaustion and cascade timeouts on Neon.

- [ ] **A2.1 — Replace `runRefresh` with sequential loop**

Replace only the `runRefresh` function (keep imports and GET/POST handlers unchanged):

```typescript
const MV_NAMES = [
  "github_user_grid_mv",
  "country_stats_mv",
  "power_users_mv",
  "company_stats_mv",
  "country_language_stats_mv",
  "user_repo_count_mv",
  "trending_repos_mv",
] as const;

const runRefresh = async () => {
  const start = Date.now();
  const results: { mv: string; durationMs: number }[] = [];

  for (const mv of MV_NAMES) {
    const t = Date.now();
    try {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
      results.push({ mv, durationMs: Date.now() - t });
    } catch (err) {
      logError(`admin/refresh-grid-mv [${mv}]`, err);
      // Continue with remaining MVs even if one fails
      results.push({ mv, durationMs: Date.now() - t });
    }
  }

  return NextResponse.json({ ok: true, durationMs: Date.now() - start, results });
};
```

Note: `$executeRawUnsafe` is required because `$executeRaw` uses tagged template literals that don't support dynamic table names. `mv` is taken from the `as const` array — not user input, safe.

- [ ] **A2.2 — Verify TypeScript**
```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **A2.3 — Commit**
```bash
git add src/app/api/admin/refresh-grid-mv/route.ts
git commit -m "fix(admin): sequential MV refresh to prevent pool exhaustion"
```

---

### Task A3: logError in stargazer-cache routes

**Files:**
- Modify: `src/app/api/stargazer-cache/route.ts` (POST)
- Modify: `src/app/api/stargazer-cache/[owner]/[repo]/route.ts` (GET)

Both routes have bare `catch {}` or `catch` blocks that swallow errors silently.

- [ ] **A3.1 — Fix POST route catch block**

In `src/app/api/stargazer-cache/route.ts`, the final `catch` block is:
```typescript
  } catch {
    return jsonError("internal", 500);
  }
```

Replace with:
```typescript
  } catch (err) {
    logError("stargazer-cache POST", err);
    return jsonError("internal", 500);
  }
```

Also add `logError` to the import at the top (it's already imported via `api-helpers` in the GET route — check the POST route's imports):
```typescript
import { jsonError, logError } from "@/lib/api-helpers";
```

- [ ] **A3.2 — Fix GET route catch block**

In `src/app/api/stargazer-cache/[owner]/[repo]/route.ts`, the final `catch` block is:
```typescript
  } catch {
    return jsonError("internal", 500);
  }
```

Replace with:
```typescript
  } catch (err) {
    logError("stargazer-cache GET", err);
    return jsonError("internal", 500);
  }
```

Add `logError` to imports:
```typescript
import { jsonError, logError } from "@/lib/api-helpers";
```

- [ ] **A3.3 — Verify TypeScript**
```bash
rtk tsc
```

- [ ] **A3.4 — Commit**
```bash
git add src/app/api/stargazer-cache/route.ts src/app/api/stargazer-cache/\[owner\]/\[repo\]/route.ts
git commit -m "fix(cache): log errors in stargazer-cache routes instead of swallowing"
```

---

## GROUP B — Design system fixes

### Task B1: Fix badge "New" contrast (WCAG AA)

**Files:**
- Modify: `src/components/announcement-banner.tsx`

Current: `bg-accent-orange text-white` — ratio ~2.6:1, WCAG AA fail for normal text.
Fix: `text-foreground` on orange gives ~7.5:1 ratio (dark text on orange).

Alternatively, change the badge to use `bg-surface border border-accent-orange text-accent-orange` which gives clear contrast on both themes.

- [ ] **B1.1 — Fix contrast**

In `announcement-banner.tsx`, find:
```typescript
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-white tracking-wide uppercase">
```

Replace with:
```typescript
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-[#0d1117] tracking-wide uppercase">
```

Note: `text-[#0d1117]` is the dark background token value — using the literal here because the token `--color-background` is dark-mode specific. An alternative is `text-background` if you confirm it maps correctly in both themes.
Actually, use `text-background` — Tailwind v4 resolves `bg-*` / `text-*` from `@theme`:
```typescript
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-background tracking-wide uppercase">
```

Verify the token in `globals.css`: `--color-background` in dark = `#0d1117`. In light mode it will be the light background — check the `html.light` block in globals.css. If light background is white/very light, `text-background` on orange will have poor contrast in light mode. In that case, use a fixed dark color:
```typescript
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-[#24292f] tracking-wide uppercase">
```

`#24292f` (GitHub dark gray) on `#f0883e` (orange) = ~5.4:1, passes AA on both themes.

- [ ] **B1.2 — Commit**
```bash
git add src/components/announcement-banner.tsx
git commit -m "fix(a11y): badge 'New' contrast WCAG AA pass (2.6:1 → 5.4:1)"
```

---

### Task B2: Unify orange palette (token-first)

**Files:**
- Modify: `src/app/globals.css` — add `orange` sub-tokens
- Modify: `src/components/organic-score-pill.tsx`
- Modify: `src/components/repo-table.tsx`
- Modify: `src/components/organic-score-modal.tsx`
- Modify: `src/app/organic-score/calibration/page.tsx`

Current: `text-orange-400`, `bg-orange-500/15`, `border-orange-500/30` scattered across 4 files. `accent-orange` token exists (`#f0883e`) but isn't used.

The Tailwind default `orange-400` = `#fb923c` (lighter). The DS token `accent-orange` = `#f0883e` (slightly different). To avoid breaking visual consistency while using the token system, add opacity-variant tokens.

- [ ] **B2.1 — Add orange tokens in globals.css**

In `src/app/globals.css`, inside the `@theme inline` block (find the `--color-accent-orange` line and add after it):
```css
  --color-accent-orange-bg: color-mix(in srgb, #f0883e 15%, transparent);
  --color-accent-orange-border: color-mix(in srgb, #f0883e 30%, transparent);
```

- [ ] **B2.2 — Update organic-score-pill.tsx**

Find:
```typescript
  moderate:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
```
Replace with:
```typescript
  moderate:     "bg-accent-orange-bg text-accent-orange border-accent-orange-border",
```

- [ ] **B2.3 — Update repo-table.tsx**

Find:
```typescript
  moderate:     "text-orange-400",
```
Replace with:
```typescript
  moderate:     "text-accent-orange",
```

- [ ] **B2.4 — Update organic-score-modal.tsx**

Replace all occurrences:
- `"text-orange-400"` → `"text-accent-orange"`
- `"bg-orange-400/10"` → `"bg-accent-orange-bg"`
- `"bg-orange-400"` → `"bg-accent-orange"`
- `"bg-orange-500/15"` → `"bg-accent-orange-bg"`
- `"border-orange-500/25"` → `"border-accent-orange-border"`

- [ ] **B2.5 — Update calibration/page.tsx**

Replace all occurrences:
- `"text-orange-400"` → `"text-accent-orange"`
- `"bg-orange-500/15 text-orange-400 border border-orange-500/30"` → `"bg-accent-orange-bg text-accent-orange border border-accent-orange-border"`

- [ ] **B2.6 — Verify TypeScript**
```bash
rtk tsc
```

- [ ] **B2.7 — Commit**
```bash
git add src/app/globals.css src/components/organic-score-pill.tsx src/components/repo-table.tsx src/components/organic-score-modal.tsx src/app/organic-score/calibration/page.tsx
git commit -m "fix(design): unify orange palette to accent-orange tokens (remove Tailwind orange-400 divergence)"
```

---

### Task B3: Update docs/design-system.md

**Files:**
- Modify: `docs/design-system.md`

6 known inconsistencies between the doc and `globals.css` actual values.

- [ ] **B3.1 — Read globals.css actual values**

Check `src/app/globals.css` dark mode block for:
- `--color-surface-alt` actual value
- `--color-muted-subtle` actual value
- `--color-accent-green` actual value

- [ ] **B3.2 — Update docs/design-system.md**

Find and replace the stale values with the actual ones from globals.css. Also add a note at the top of the doc:
```markdown
> **Last verified:** 2026-05-09 — cross-checked with `src/app/globals.css`.
```

- [ ] **B3.3 — Commit**
```bash
git add docs/design-system.md
git commit -m "docs(design): sync design-system.md with globals.css actual token values"
```

---

## GROUP C — Frontend performance: world-atlas public asset

### Task C1: world-atlas → public asset (remove -250 KB duplicate bundle)

**Files:**
- Create: `public/world-110m.json` (copy from node_modules)
- Modify: `src/components/map/country-choropleth.tsx`
- Modify: `src/components/map/language-choropleth.tsx`

Current: Both choropleth components `require("world-atlas/countries-110m.json")` at module scope — bundled into JS (~250 KB each, ~500 KB total). Loading as a public asset removes it from JS bundles entirely and allows browser caching.

- [ ] **C1.1 — Copy world-atlas topology to public/**

```bash
cp node_modules/world-atlas/countries-110m.json public/world-110m.json
```

Verify it copied:
```bash
ls -la public/world-110m.json
```
Expected: ~242 KB file.

- [ ] **C1.2 — Update country-choropleth.tsx**

In `src/components/map/country-choropleth.tsx`:

Remove the module-level `require`:
```typescript
// DELETE THIS LINE:
const topoData = require("world-atlas/countries-110m.json") as Topology;
```

Add `topoData` as state fetched on mount. Find the component's state declarations and add:
```typescript
const [topoData, setTopoData] = useState<Topology | null>(null);

useEffect(() => {
  fetch("/world-110m.json")
    .then((r) => r.json())
    .then((data) => setTopoData(data as Topology))
    .catch(() => {}); // silent — map renders empty on network error
}, []);
```

Update any early return that uses `topoData`:
- If the component already has a loading guard (`if (!topoData) return null` or similar) — just ensure it handles `null` properly.
- If `topoData` was used directly in render without a guard, add: `if (!topoData) return null;` before the first use.

- [ ] **C1.3 — Update language-choropleth.tsx**

Same pattern as C1.2:

Remove the module-level `require`:
```typescript
// DELETE THIS LINE:
const topoData = require("world-atlas/countries-110m.json") as Topology;
```

Add state + fetch:
```typescript
const [topoData, setTopoData] = useState<Topology | null>(null);

useEffect(() => {
  fetch("/world-110m.json")
    .then((r) => r.json())
    .then((data) => setTopoData(data as Topology))
    .catch(() => {});
}, []);
```

Add null guard before first use of `topoData` in render.

- [ ] **C1.4 — Verify TypeScript**
```bash
rtk tsc
```
Expected: 0 errors. Common issue: `Topology | null` where `Topology` is expected — add null guard.

- [ ] **C1.5 — Test locally**

Start dev server and navigate to `/devs/atlas` — the choropleth map should render correctly (topology loaded via fetch instead of bundle).

```bash
pnpm dev
```

Open `http://localhost:3000/devs/atlas` — verify map renders with country colors.

- [ ] **C1.6 — Commit**
```bash
git add public/world-110m.json src/components/map/country-choropleth.tsx src/components/map/language-choropleth.tsx
git commit -m "perf(bundle): world-atlas as public asset (-250 KB JS bundle, browser-cached)"
```

---

## GROUP D — Console cleanup

### Task D1: Remove console.error from devs pages

**Files:**
- Modify: `src/app/devs/[language]/page.tsx` (lines 110, 133)
- Modify: `src/app/devs/atlas/page.tsx` (line 179)
- Modify: `src/app/devs/page.tsx` (line 32)

All four are `if (e.name !== "AbortError") console.error(...)` in fetch error handlers. These log to browser console in production. Fetch errors in these components should fail silently (the UI handles empty states).

- [ ] **D1.1 — Fix devs/[language]/page.tsx**

Find (around line 110):
```typescript
        if (e.name !== "AbortError") console.error("[devs] options fetch error:", e);
```
Delete this line (the `catch` block can stay empty or just check abort).

Find (around line 133):
```typescript
        if (e.name !== "AbortError") console.error("[devs] fetch error:", e);
```
Delete this line.

Result: catch blocks that only check AbortError can be simplified to empty catch, or check can be removed entirely since there's nothing to do in either branch.

- [ ] **D1.2 — Fix devs/atlas/page.tsx**

Find (around line 179):
```typescript
        if (e.name !== "AbortError") console.error("[devs/atlas] fetch error:", e);
```
Delete this line.

- [ ] **D1.3 — Fix devs/page.tsx**

Find (around line 32):
```typescript
        if (e.name !== "AbortError") console.error("[devs/hub] fetch error:", e);
```
Delete this line.

- [ ] **D1.4 — Verify TypeScript**
```bash
rtk tsc
```

- [ ] **D1.5 — Commit**
```bash
git add src/app/devs/\[language\]/page.tsx src/app/devs/atlas/page.tsx src/app/devs/page.tsx
git commit -m "fix(devs): remove console.error from production fetch error handlers"
```

---

## Phase 2 — Deferred (after Phase 1 merge)

These require more context / larger scope and should not be parallelised with Phase 1:

| Task | Scope | Effort |
|------|-------|--------|
| Page monolith extraction | `[owner]/[repo]/page.tsx` (2571 lines) → extract each modal as `dynamic()` | 2-3 days |
| `<Button>` component | Unify 3 ghost variants across landing, map, header | 1 day |
| Inline modals → `modal.tsx` | `page.tsx:1033, 1073, 1339` — migrate to `Modal` + add focus-trap | 4h |
| Slim GeoJSON properties | `stargazer-map.tsx:179-188` — strip bio/linkedinUrl/avatarUrl, use side-Map for popups | 4h |
| LRU on profileFetchCache | Replace `.clear()` with LRU-style eviction (cap at 100 entries) | 1h |
| AbortController on mount fetches | `[owner]/[repo]/page.tsx:272-390` — cancel on unmount | 3h |
| `prefers-reduced-motion` | `stargazer-map.tsx` flyTo/easeTo/spider | 1h |
| `dvh`/`svh` on modals | `page.tsx:1456, 2197` — replace `max-h-[Xvh]` | 1h |
| NextImage `sizes` prop | `page.tsx:1162, 1678, 1815` — small avatars need `sizes="24px"` | 30min |
| MV centralized setup script | `prisma/sql/views.sql` + `pnpm setup:mvs` idempotent | 4-6h |
| ApiKey plaintext fallback removal | Confirm `pnpm backfill:api-key-hash:prod` ran, then remove fallback in `geo/route.ts` | 1h |
| Concurrency cap Upstash global | `chunk/route.ts` — replace per-Lambda counter with Redis INCR | 3h |
