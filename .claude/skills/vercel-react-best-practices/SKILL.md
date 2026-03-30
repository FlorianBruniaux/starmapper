---
name: vercel-react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. Use when writing, reviewing, or refactoring React/Next.js code in StarMapper — especially MapLibre components, data fetching, and bundle optimization.
version: "1.0.0"
effort: medium
allowed-tools: [Read, Grep, Glob]
tags: [react, nextjs, performance, vercel, optimization]
---

# Vercel React Best Practices — StarMapper

Performance optimization guide for React 19 + Next.js 16.2 on Vercel free tier.

## When to Apply

- Writing new React components or Next.js pages
- Implementing data fetching (chunk loop, cache reads)
- Reviewing components for performance issues
- Optimizing bundle size (MapLibre is heavy at ~900KB)
- Refactoring existing code

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Eliminating Waterfalls | CRITICAL | `async-` |
| 2 | Bundle Size Optimization | CRITICAL | `bundle-` |
| 3 | Server-Side Performance | HIGH | `server-` |
| 4 | Re-render Optimization | MEDIUM | `rerender-` |
| 5 | Rendering Performance | MEDIUM | `rendering-` |
| 6 | JavaScript Performance | LOW-MEDIUM | `js-` |

## Quick Reference

### 1. Eliminating Waterfalls (CRITICAL)

- `async-parallel` — Use `Promise.all()` for independent operations
  ```typescript
  // ✅ parallel: fetch repo info and check cache simultaneously
  const [repoInfo, cached] = await Promise.all([
    fetchRepoInfo(owner, repo),
    checkStargazerCache(owner, repo),
  ]);
  ```

- `async-api-routes` — Start promises early, await late
  ```typescript
  // ✅ start DB lookup early
  const cachePromise = db.stargazerCache.findUnique({ where: { owner_repo: { owner, repo } } });
  // ... other sync work ...
  const cached = await cachePromise;
  ```

- `async-defer-await` — Only await in the branch that needs it

### 2. Bundle Size Optimization (CRITICAL for MapLibre)

- `bundle-dynamic-imports` — MapLibre GL is ~900KB, always dynamic:
  ```typescript
  // ✅ correct — StarMapper uses this pattern
  import dynamic from "next/dynamic";
  const StargazerMapDynamic = dynamic(() => import("./stargazer-map"), { ssr: false });
  ```

- `bundle-barrel-imports` — Import directly, avoid index.ts barrel files:
  ```typescript
  // ❌ barrel (pulls in everything)
  import { geocode, geocodeBatch } from "@/lib";
  // ✅ direct import
  import { geocode } from "@/lib/geocoder";
  ```

- `bundle-defer-third-party` — Load analytics/non-critical scripts after hydration

- `bundle-conditional` — Only load MapLibre when user navigates to map page (Next.js App Router handles this naturally via route segments)

### 3. Server-Side Performance (HIGH)

- `server-cache-react` — Use `React.cache()` for per-request deduplication in Server Components:
  ```typescript
  import { cache } from "react";
  const getCachedRepoInfo = cache(async (owner: string, repo: string) => {
    return fetchRepoInfo(owner, repo);
  });
  ```

- `server-serialization` — Minimize data passed to client components:
  ```typescript
  // ❌ pass entire object with 50 fields
  <StargazerMap repoData={fullRepoData} />
  // ✅ only what's needed
  <StargazerMap owner={owner} repo={repo} stars={stars} />
  ```

- `server-parallel-fetching` — Parallel Server Component data fetching for map page

### 4. Re-render Optimization (MEDIUM)

- `rerender-memo` — `memo()` for StargazerMap (re-renders on every points update):
  ```typescript
  export const StargazerMap = memo(({ points, ... }: Props) => {
    // ...
  });
  ```

- `rerender-dependencies` — Use primitive dependencies in effects:
  ```typescript
  // ❌ object reference changes every render
  useEffect(() => { ... }, [repoData]);
  // ✅ primitive values
  useEffect(() => { ... }, [owner, repo]);
  ```

- `rerender-memo` — Extract GeoJSON feature array into useMemo:
  ```typescript
  const geojsonData = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: points.map(pointToFeature),
  }), [points]);
  ```

- `rerender-functional-setstate` — Use functional setState for chunk loop accumulation:
  ```typescript
  setPoints(prev => [...prev, ...newPoints]);
  ```

### 5. Rendering Performance (MEDIUM)

- `rendering-hydration-no-flicker` — Use inline script for dark/light theme (StarMapper already does this in `layout.tsx`):
  ```typescript
  // ✅ inline script prevents FOUC on theme load
  ```

- `rendering-conditional-render` — Use ternary, not `&&` for conditional rendering:
  ```typescript
  // ❌ risky with 0/falsy values
  {count && <Badge count={count} />}
  // ✅ explicit
  {count > 0 ? <Badge count={count} /> : null}
  ```

### 6. JavaScript Performance (LOW-MEDIUM)

- `js-index-maps` — Build Map for repeated lookups (e.g., country name normalization):
  ```typescript
  // Build once, lookup many times
  const countryMap = new Map(countries.map(c => [c.code, c.name]));
  ```

- `js-set-map-lookups` — Use Set for `has()` checks over `includes()`:
  ```typescript
  const unmappedSet = new Set(unmapped.map(u => u.login));
  const isUnmapped = unmappedSet.has(login); // O(1) vs O(n)
  ```

- `js-early-exit` — Return early from geocoding functions

## StarMapper-Specific Notes

- **MapLibre GL bundle** (~900KB) is the single biggest bundle concern. Dynamic import with `ssr:false` is mandatory and already in place via `stargazer-map-dynamic.tsx`.
- **Chunk loop state** accumulates progressively — `setPoints(prev => [...prev, ...newPoints])` is correct functional setState pattern.
- **GeoJSON construction** is O(n) with n=stars — `useMemo` on `points` array is important for large repos.
- **Vercel free = no Edge Runtime needed** — standard Node.js serverless functions work fine.
