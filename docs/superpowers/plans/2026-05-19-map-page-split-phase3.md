# MapPage Split Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `src/app/[owner]/[repo]/page.tsx` from 1373 lines to ≤700 by extracting 2 hooks and 5 JSX components, with no functional changes.

**Architecture:** Extract the two largest logic blocks into custom hooks (`useRepoCacheLoader`, `useCompareScan`) that own their state internally and return values (same pattern as `useScanController`). Then extract the five inline JSX blocks as focused components. `ShareModal` goes last — it requires migrating local state and a controlled prop for `liDraft`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest + @testing-library/react, Tailwind v4

---

## File Map

**New files (create):**
- `src/hooks/use-repo-cache-loader.ts` — cache loader hook (owns `cacheCheckDone`, `lastDbScan`, `serverStats`)
- `src/hooks/use-repo-cache-loader.test.ts` — unit tests
- `src/hooks/use-compare-scan.ts` — compare scan hook (owns all compare state)
- `src/hooks/use-compare-scan.test.ts` — unit tests
- `src/components/map/rate-limited-modal.tsx` — rate limit modal (error alertdialog)
- `src/components/map/not-found-modal.tsx` — repo not found modal
- `src/components/map/rate-limit-overlay.tsx` — scan waiting overlay
- `src/components/map/pre-scan-overlay.tsx` — pre-scan start overlay
- `src/components/map/share-modal.tsx` — full share modal (~312 lines inline)

**Modified files:**
- `src/app/[owner]/[repo]/page.tsx` — remove extracted code, wire new imports

---

## Task 1: `useRepoCacheLoader` — tests

**Files:**
- Create: `src/hooks/use-repo-cache-loader.test.ts`

- [ ] **Step 1.1: Create the test file with mocks**

```typescript
// src/hooks/use-repo-cache-loader.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLoadCache = vi.fn();
const mockSaveCache = vi.fn();
const mockSaveBookmark = vi.fn();
const mockCompressToBase64 = vi.fn();
const mockFetch = vi.fn();

vi.mock("@/lib/repo-cache", () => ({
  loadCache: (...a: unknown[]) => mockLoadCache(...a),
  saveCache: (...a: unknown[]) => mockSaveCache(...a),
}));
vi.mock("@/lib/bookmarks", () => ({
  saveBookmark: (...a: unknown[]) => mockSaveBookmark(...a),
}));
vi.mock("@/lib/compress-client", () => ({
  compressToBase64: (...a: unknown[]) => mockCompressToBase64(...a),
}));
vi.mock("@/lib/countries", () => ({
  isCountry: () => false,
  normalizeCountry: (s: string) => s,
}));

// Will be imported after mocks
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";
import type { ScanAction } from "@/hooks/useScanController";
import type { ScanStatus } from "@/hooks/use-repo-cache-loader";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LOCAL_CACHE = {
  points: [{ login: "alice", lat: 48, lng: 2, followers: 10, name: null, location: "Paris", company: null, bio: null, avatarUrl: null, starredAt: null }],
  unmapped: [],
  totalCount: 1,
  scannedAt: 1000,
  latestStarredAt: null,
};

const makeOpts = (overrides = {}) => ({
  owner: "test",
  repo: "repo",
  repoInfo: null,
  dispatch: vi.fn(),
  setTotal: vi.fn(),
  setCachedAt: vi.fn(),
  setLatestStarredAt: vi.fn(),
  setStatus: vi.fn(),
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useRepoCacheLoader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadCache.mockReturnValue(null);
    mockCompressToBase64.mockResolvedValue("gz==");
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  // ── localStorage hit ──────────────────────────────────────────────────────

  it("dispatches set + setStatus(cached) when localStorage has data", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledWith({
      type: "set",
      points: LOCAL_CACHE.points,
      unmapped: LOCAL_CACHE.unmapped,
    }));
    expect(opts.setStatus).toHaveBeenCalledWith("cached");
  });

  it("returns cacheCheckDone=true after DB fetch resolves", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
  });

  // ── DB 200, scannedMs > local ─────────────────────────────────────────────

  it("overwrites local cache when DB has newer data", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE); // scannedAt: 1000
    const dbPoints = [{ ...LOCAL_CACHE.points[0], login: "bob" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) {
        return jsonResponse({ points: dbPoints, unmapped: [], totalCount: 1, scannedAt: new Date(2000).toISOString(), latestStarredAt: null });
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledWith({
      type: "set",
      points: dbPoints,
      unmapped: [],
    }));
  });

  // ── DB 200, scannedMs <= local — MUST silently discard ────────────────────

  it("silently discards DB data when scannedMs <= local.scannedAt", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE); // scannedAt: 1000
    const oldDbPoints = [{ ...LOCAL_CACHE.points[0], login: "old" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) {
        return jsonResponse({ points: oldDbPoints, unmapped: [], totalCount: 1, scannedAt: new Date(500).toISOString(), latestStarredAt: null }); // 500 < 1000
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.setCachedAt).toHaveBeenCalledWith(LOCAL_CACHE.scannedAt));
    // dispatch called only once (from localStorage), not from DB
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledTimes(1));
  });

  // ── DB 206 ────────────────────────────────────────────────────────────────

  it("sets lastDbScan from 206 when no local cache", async () => {
    mockLoadCache.mockReturnValue(null);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) return jsonResponse({ lastScan: "2026-01-01" }, 206);
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.lastDbScan).toBe("2026-01-01"));
  });

  it("calls donate when DB 206 + local cache exists", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache") && url.includes("/test/repo")) return jsonResponse({ lastScan: "x" }, 206);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(mockCompressToBase64).toHaveBeenCalled());
  });

  // ── DB 404 ────────────────────────────────────────────────────────────────

  it("calls donate when DB 404 + local cache exists", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache") && url.includes("/test/repo")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(mockCompressToBase64).toHaveBeenCalled());
  });

  // ── DB down ───────────────────────────────────────────────────────────────

  it("sets cacheCheckDone=true even when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
  });
});
```

- [ ] **Step 1.2: Run tests — expect FAIL (module not found)**

```bash
rtk vitest run src/hooks/use-repo-cache-loader.test.ts
```

Expected: `Error: Cannot find module '@/hooks/use-repo-cache-loader'`

---

## Task 2: `useRepoCacheLoader` — implementation

**Files:**
- Create: `src/hooks/use-repo-cache-loader.ts`
- Modify: `src/app/[owner]/[repo]/page.tsx` (remove extracted code, add import)

- [ ] **Step 2.1: Create the hook**

```typescript
// src/hooks/use-repo-cache-loader.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useEffect, useRef, useState } from "react";
import { loadCache, saveCache } from "@/lib/repo-cache";
import { saveBookmark } from "@/lib/bookmarks";
import { compressToBase64 } from "@/lib/compress-client";
import { isCountry, normalizeCountry } from "@/lib/countries";
import type { ScanAction, ScanStatus } from "@/hooks/useScanController";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { LocalCache } from "@/lib/repo-cache";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";

export type { ScanStatus };

type RepoInfo = { forksCount?: number; watchersCount?: number };

type Options = {
  owner: string;
  repo: string;
  repoInfo: RepoInfo | null;
  dispatch: React.Dispatch<ScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setCachedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setLatestStarredAt: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<ScanStatus>>;
};

type Result = {
  cacheCheckDone: boolean;
  lastDbScan: string | null;
  serverStats: RepoStats | null;
};

const donateLocalCacheToDb = (owner: string, repo: string, cache: LocalCache) => {
  (async () => {
    try {
      type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
      const slim: SlimPoint[] = cache.points.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
      const [pointsGz, unmappedGz] = await Promise.all([
        compressToBase64(slim),
        compressToBase64(cache.unmapped),
      ]);
      await fetch("/api/stargazer-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner, repo, pointsGz, unmappedGz,
          totalCount: cache.totalCount,
          latestStarredAt: cache.latestStarredAt,
          ts: Date.now(),
        }),
      });
    } catch { /* fire-and-forget */ }
  })();
};

export const useRepoCacheLoader = ({
  owner, repo, repoInfo, dispatch,
  setTotal, setCachedAt, setLatestStarredAt, setStatus,
}: Options): Result => {
  const [cacheCheckDone, setCacheCheckDone] = useState(false);
  const [lastDbScan, setLastDbScan] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<RepoStats | null>(null);

  // Ref so the badge-sync effect can read latest repoInfo without re-triggering the main effect.
  const repoInfoRef = useRef(repoInfo);
  repoInfoRef.current = repoInfo;

  // Effect 1: load localStorage + revalidate against DB
  useEffect(() => {
    const local = loadCache(owner, repo);
    if (local) {
      dispatch({ type: "set", points: local.points, unmapped: local.unmapped });
      setTotal(local.totalCount);
      setCachedAt(local.scannedAt);
      setLatestStarredAt(local.latestStarredAt ?? null);
      setStatus("cached");
      saveBookmark(owner, repo, local.totalCount);
      setCacheCheckDone(true);
    }

    const ac = new AbortController();
    fetch(`/api/stargazer-cache/${owner}/${repo}`, { signal: ac.signal })
      .then(async (r) => {
        if (r.status === 206) {
          const d = await r.json();
          if (!local) setLastDbScan(d.lastScan);
          else donateLocalCacheToDb(owner, repo, local);
          return;
        }
        if (!r.ok) {
          if (local) donateLocalCacheToDb(owner, repo, local);
          return;
        }
        const data = await r.json();
        if (!data.points) return;
        const scannedMs = new Date(data.scannedAt).getTime();
        if (local && scannedMs <= local.scannedAt) return;
        dispatch({ type: "set", points: data.points, unmapped: data.unmapped });
        setTotal(data.totalCount);
        setCachedAt(scannedMs);
        setLatestStarredAt(data.latestStarredAt ?? null);
        setStatus("cached");
        saveBookmark(owner, repo, data.totalCount);
        saveCache(owner, repo, {
          points: data.points,
          unmapped: data.unmapped,
          totalCount: data.totalCount,
          scannedAt: scannedMs,
          latestStarredAt: data.latestStarredAt ?? null,
        });
      })
      .catch(() => {})
      .finally(() => setCacheCheckDone(true));
    return () => ac.abort();
  }, [owner, repo, dispatch, setTotal, setCachedAt, setLatestStarredAt, setStatus]);

  // Effect 2: badge-sync — fires after localStorage hit, reads repoInfo via ref so it
  // doesn't re-run on every repoInfo update (forksCount/watchersCount are bonus fields).
  useEffect(() => {
    const local = loadCache(owner, repo);
    if (!local) return;
    const countrySet = new Set(
      local.points
        .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
        .filter(Boolean),
    );
    const ri = repoInfoRef.current;
    fetch("/api/badge-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        repo,
        mappedCount: local.points.length,
        countryCount: countrySet.size,
        totalCount: local.totalCount,
        ...(ri?.forksCount !== undefined && { forksCount: ri.forksCount }),
        ...(ri?.watchersCount !== undefined && { watchersCount: ri.watchersCount }),
      }),
    })
      .then(() => fetch(`/api/stats/${owner}/${repo}`))
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setServerStats(data); })
      .catch(() => {});
  }, [owner, repo]);

  return { cacheCheckDone, lastDbScan, serverStats };
};
```

- [ ] **Step 2.2: Run tests — expect all green**

```bash
rtk vitest run src/hooks/use-repo-cache-loader.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2.3: Wire into page.tsx — remove extracted code, add import**

In `src/app/[owner]/[repo]/page.tsx`, apply the following changes:

**Add import** (after the existing hooks imports):
```typescript
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";
```

**Remove** these state declarations (lines ~85-87, ~117):
```typescript
// REMOVE:
const [cachedAt, setCachedAt] = useState<number | null>(null);
const [lastDbScan, setLastDbScan] = useState<string | null>(null);
// ... (latestStarredAt already used by useScanController — keep it)
const [serverStats, setServerStats] = useState<RepoStats | null>(null);
const [cacheCheckDone, setCacheCheckDone] = useState(false);
```

**Replace** the loadCache useEffect block AND the badge-sync fetch block (lines ~233-354) with:
```typescript
const { cacheCheckDone, lastDbScan, serverStats: cacheServerStats } = useRepoCacheLoader({
  owner, repo, repoInfo,
  dispatch, setTotal, setCachedAt, setLatestStarredAt, setStatus,
});
const [serverStats, setServerStats] = useState<RepoStats | null>(null);
// Merge: prefer stats fetch result, fall back to cache loader's stats
const mergedServerStats = serverStats ?? cacheServerStats;
```

**Remove** the standalone `fetch(/api/stats/...)` useEffect (lines ~337-344) — now handled by the hook.

**Update** any reference to `serverStats` to use `mergedServerStats` in the JSX.

- [ ] **Step 2.4: TypeScript check**

```bash
rtk tsc
```

Expected: no new errors beyond the pre-existing 99.

- [ ] **Step 2.5: Commit**

```bash
git add src/hooks/use-repo-cache-loader.ts src/hooks/use-repo-cache-loader.test.ts src/app/[owner]/[repo]/page.tsx
git commit -m "refactor(map-page): extract useRepoCacheLoader hook (#50)

- New src/hooks/use-repo-cache-loader.ts: owns cacheCheckDone, lastDbScan, serverStats
- Badge-sync extracted to its own effect (no repoInfoRef hack)
- Returns { cacheCheckDone, lastDbScan, serverStats } — same pattern as useScanController

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `useCompareScan` — tests

**Files:**
- Create: `src/hooks/use-compare-scan.test.ts`

- [ ] **Step 3.1: Create the test file**

```typescript
// src/hooks/use-compare-scan.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();

vi.mock("@/components/token-modal", () => ({
  getStoredToken: () => null,
}));

import { useCompareScan } from "@/hooks/use-compare-scan";

const makeChunk = (nextCursor: string | null = null) => ({
  points: [{ login: "alice", lat: 48, lng: 2, followers: 0, name: null, location: null, company: null, bio: null, avatarUrl: null, starredAt: null }],
  unmapped: [],
  nextCursor,
  totalCount: 1,
});

const jsonOk = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

describe("useCompareScan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const ghHeaders = () => ({ "Content-Type": "application/json" });

  // ── Initial state ─────────────────────────────────────────────────────────

  it("starts with all compare state null/idle/empty", () => {
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    expect(result.current.compareOwner).toBeNull();
    expect(result.current.compareRepo).toBeNull();
    expect(result.current.compareStatus).toBe("idle");
    expect(result.current.comparePoints).toEqual([]);
    expect(result.current.compareInfo).toBeNull();
  });

  // ── No fetch when no owner/repo ───────────────────────────────────────────

  it("does not fetch when compareOwner/compareRepo are null", async () => {
    renderHook(() => useCompareScan(ghHeaders));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Scan completion ───────────────────────────────────────────────────────

  it("runs chunk loop until nextCursor is null, sets compareStatus=done", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("chunk")) return jsonOk(makeChunk(null));
      if (url.includes("repo-info")) return jsonOk({ name: "next.js", stars: 100 });
      return new Response(null, { status: 404 });
    });
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("vercel"); result.current.setCompareRepo("next.js"); });
    await waitFor(() => expect(result.current.compareStatus).toBe("done"));
    expect(result.current.comparePoints.length).toBeGreaterThan(0);
  });

  // ── Throttle ──────────────────────────────────────────────────────────────

  it("throttles setComparePoints — does not update on every chunk within 2s window", async () => {
    let callCount = 0;
    // 3 chunks, nextCursor non-null for first two
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("chunk")) {
        callCount++;
        return jsonOk(makeChunk(callCount < 3 ? "cursor" : null));
      }
      if (url.includes("repo-info")) return jsonOk({ name: "r", stars: 0 });
      return new Response(null, { status: 404 });
    });
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("a"); result.current.setCompareRepo("b"); });
    await waitFor(() => expect(result.current.compareStatus).toBe("done"));
    // Final state always applied — points must be non-empty
    expect(result.current.comparePoints.length).toBe(3);
  });

  // ── AbortController ───────────────────────────────────────────────────────

  it("aborts repo-info fetch on unmount", async () => {
    let aborted = false;
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => { aborted = true; });
      }
      return new Promise(() => {}); // never resolves
    });
    const { result, unmount } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("a"); result.current.setCompareRepo("b"); });
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run — expect FAIL (module not found)**

```bash
rtk vitest run src/hooks/use-compare-scan.test.ts
```

Expected: `Cannot find module '@/hooks/use-compare-scan'`

---

## Task 4: `useCompareScan` — implementation

**Files:**
- Create: `src/hooks/use-compare-scan.ts`
- Modify: `src/app/[owner]/[repo]/page.tsx`

- [ ] **Step 4.1: Create the hook**

```typescript
// src/hooks/use-compare-scan.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useState, useRef, useCallback, useEffect } from "react";
import { getStoredToken } from "@/components/token-modal";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
};

export type UseCompareScanReturn = {
  compareOwner: string | null;
  setCompareOwner: (s: string | null) => void;
  compareRepo: string | null;
  setCompareRepo: (s: string | null) => void;
  comparePoints: StargazerPoint[];
  compareStatus: "idle" | "loading" | "done";
  compareInfo: RepoInfo | null;
};

export const useCompareScan = (
  ghHeaders: () => Record<string, string>,
): UseCompareScanReturn => {
  const [compareOwner, setCompareOwner] = useState<string | null>(null);
  const [compareRepo, setCompareRepo] = useState<string | null>(null);
  const [comparePoints, setComparePoints] = useState<StargazerPoint[]>([]);
  const [compareStatus, setCompareStatus] = useState<"idle" | "loading" | "done">("idle");
  const [compareInfo, setCompareInfo] = useState<RepoInfo | null>(null);
  const compareRunningRef = useRef(false);

  const startCompareScan = useCallback(async () => {
    if (!compareOwner || !compareRepo || compareRunningRef.current) return;
    compareRunningRef.current = true;
    setCompareStatus("loading");
    let cursor: string | null = null;
    const allPts: StargazerPoint[] = [];
    let lastUpdate = 0;
    try {
      while (true) {
        const res = await fetch("/api/chunk", {
          method: "POST",
          headers: ghHeaders(),
          body: JSON.stringify({ owner: compareOwner, repo: compareRepo, cursor }),
        });
        if (!res.ok) break;
        const chunk = await res.json() as ChunkResponse;
        allPts.push(...chunk.points);
        const now = Date.now();
        if (now - lastUpdate >= 2000) {
          setComparePoints([...allPts]);
          lastUpdate = now;
        }
        if (!chunk.nextCursor) break;
        cursor = chunk.nextCursor;
      }
    } catch {
      setCompareStatus("done");
      compareRunningRef.current = false;
      return;
    }
    setComparePoints([...allPts]);
    setCompareStatus("done");
    compareRunningRef.current = false;
  }, [compareOwner, compareRepo, ghHeaders]);

  useEffect(() => {
    if (!compareOwner || !compareRepo) return;
    const ac = new AbortController();
    const t = getStoredToken();
    fetch(`/api/repo-info?owner=${compareOwner}&repo=${compareRepo}`, {
      headers: t ? { "x-gh-token": t } : {},
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((d: RepoInfo & { error?: string }) => { if (!d.error) setCompareInfo(d); })
      .catch(() => {});
    startCompareScan();
    return () => ac.abort();
  }, [compareOwner, compareRepo, startCompareScan]);

  return {
    compareOwner, setCompareOwner,
    compareRepo, setCompareRepo,
    comparePoints, compareStatus, compareInfo,
  };
};
```

- [ ] **Step 4.2: Run tests — expect all green**

```bash
rtk vitest run src/hooks/use-compare-scan.test.ts
```

Expected: all PASS.

- [ ] **Step 4.3: Wire into page.tsx**

**Add import:**
```typescript
import { useCompareScan } from "@/hooks/use-compare-scan";
```

**Remove** the 6 compare state declarations + ref (lines ~135-141):
```typescript
// REMOVE these lines:
const [compareOwner, setCompareOwner] = useState<string | null>(null);
const [compareRepo, setCompareRepo] = useState<string | null>(null);
const [comparePoints, setComparePoints] = useState<StargazerPoint[]>([]);
const [compareStatus, setCompareStatus] = useState<"idle" | "loading" | "done">("idle");
const [compareInfo, setCompareInfo] = useState<RepoInfo | null>(null);
const compareRunningRef = useRef(false);
```

**Replace** `startCompareScan` callback + the compare useEffect (lines ~356-416) with:
```typescript
const {
  compareOwner, setCompareOwner,
  compareRepo, setCompareRepo,
  comparePoints, compareStatus, compareInfo,
} = useCompareScan(ghHeaders);
```

**Keep** the two remaining effects that reference compare state:
```typescript
// Sync viewMode to map imperatively (no re-render)
useEffect(() => {
  mapControlsRef.current?.setViewMode(viewMode);
}, [viewMode]);

// Reset to clusters when compare mode activates
useEffect(() => {
  if (compareOwner && compareRepo) setViewMode("clusters");
}, [compareOwner, compareRepo]);
```

- [ ] **Step 4.4: TypeScript check**

```bash
rtk tsc
```

Expected: no new errors.

- [ ] **Step 4.5: Commit**

```bash
git add src/hooks/use-compare-scan.ts src/hooks/use-compare-scan.test.ts src/app/[owner]/[repo]/page.tsx
git commit -m "refactor(map-page): extract useCompareScan hook (#50)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `RateLimitedModal` + `RepoNotFoundModal`

**Files:**
- Create: `src/components/map/rate-limited-modal.tsx`
- Create: `src/components/map/not-found-modal.tsx`
- Modify: `src/app/[owner]/[repo]/page.tsx`

- [ ] **Step 5.1: Create `RateLimitedModal`**

```typescript
// src/components/map/rate-limited-modal.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = {
  open: boolean;
  onAddToken: () => void;
};

export const RateLimitedModal = ({ open, onAddToken }: Props) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-limited-title"
        className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 shrink-0 flex items-center justify-center rounded-lg bg-accent-orange/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-orange" aria-hidden="true">
              <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
            </svg>
          </div>
          <div>
            <h2 id="rate-limited-title" className="text-foreground font-semibold text-sm mb-1">GitHub rate limit reached</h2>
            <p className="text-muted text-xs leading-relaxed">
              The GitHub API limit has been hit. Add a personal access token to unlock higher limits and continue.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAddToken}
            className="flex items-center justify-center gap-2 w-full bg-accent-green-emphasis hover:opacity-90 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity"
          >
            Add a GitHub token
          </button>
          <a
            href="/"
            className="flex items-center justify-center gap-2 w-full border border-border text-muted hover:text-foreground font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            Back to StarMapper
          </a>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 5.2: Create `RepoNotFoundModal`**

```typescript
// src/components/map/not-found-modal.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = {
  open: boolean;
  owner: string;
  repo: string;
};

export const RepoNotFoundModal = ({ open, owner, repo }: Props) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="not-found-title"
        className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 shrink-0 flex items-center justify-center rounded-lg bg-accent-red/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-red" aria-hidden="true">
              <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .39.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.39.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
            </svg>
          </div>
          <div>
            <h2 id="not-found-title" className="text-foreground font-semibold text-sm mb-1">Repository not found</h2>
            <p className="text-muted text-xs leading-relaxed">
              <span className="text-foreground font-medium">{owner}/{repo}</span> doesn&apos;t exist on GitHub or isn&apos;t accessible. Check the URL and try again.
            </p>
          </div>
        </div>
        <a
          href="/"
          className="flex items-center justify-center gap-2 w-full bg-accent-green-emphasis hover:opacity-90 text-white font-medium py-2.5 rounded-lg text-sm transition-opacity"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
          </svg>
          Back to StarMapper
        </a>
      </div>
    </div>
  );
};
```

- [ ] **Step 5.3: Update page.tsx**

Add imports:
```typescript
import { RateLimitedModal } from "@/components/map/rate-limited-modal";
import { RepoNotFoundModal } from "@/components/map/not-found-modal";
```

Replace the inline `{/* GitHub rate limit modal */}` block (lines ~556-594) with:
```tsx
<RateLimitedModal
  open={repoRateLimited}
  onAddToken={() => { setRepoRateLimited(false); setTokenOpen(true); }}
/>
```

Replace the inline `{/* Repo not found modal */}` block (lines ~596-629) with:
```tsx
<RepoNotFoundModal open={repoNotFound} owner={owner} repo={repo} />
```

- [ ] **Step 5.4: TypeScript + commit**

```bash
rtk tsc
git add src/components/map/rate-limited-modal.tsx src/components/map/not-found-modal.tsx src/app/[owner]/[repo]/page.tsx
git commit -m "refactor(map-page): extract RateLimitedModal + RepoNotFoundModal (#50)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `RateLimitOverlay` + `PreScanOverlay`

**Files:**
- Create: `src/components/map/rate-limit-overlay.tsx`
- Create: `src/components/map/pre-scan-overlay.tsx`
- Modify: `src/app/[owner]/[repo]/page.tsx`

- [ ] **Step 6.1: Create `RateLimitOverlay`**

```typescript
// src/components/map/rate-limit-overlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { ScanStatus } from "@/hooks/useScanController";

type Props = {
  status: ScanStatus;
  waitReason: string | null;
  retryIn: number;
  retryTotal: number;
};

export const RateLimitOverlay = ({ status, waitReason, retryIn, retryTotal }: Props) => {
  if (status !== "waiting") return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/75 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-wait-title"
        className="bg-surface border border-border rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-center"
      >
        <div className="flex justify-center mb-5" aria-hidden="true">
          <svg className="animate-spin motion-reduce:animate-none w-10 h-10 text-accent-blue" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
        <h2 id="rate-wait-title" className="text-foreground font-semibold text-base mb-1">
          {waitReason === "github" ? "GitHub quota reached" : "Server busy"}
        </h2>
        <p className="text-muted text-sm mb-5">
          {waitReason === "github"
            ? "GitHub API rate limit hit. Resuming automatically when quota resets in"
            : "Too many scans running at once. Resuming automatically in"}
        </p>
        <div
          className="text-5xl font-bold text-accent-blue tabular-nums mb-5"
          aria-live="polite"
          aria-atomic="true"
        >
          {retryIn}
        </div>
        <div
          role="progressbar"
          aria-valuenow={retryTotal > 0 ? retryTotal - retryIn : 0}
          aria-valuemin={0}
          aria-valuemax={retryTotal}
          aria-label="Time until retry"
          className="w-full bg-surface-alt rounded-full h-1 overflow-hidden"
        >
          <div
            className="bg-accent-blue h-full rounded-full transition-all duration-1000 motion-reduce:transition-none"
            style={{ width: retryTotal > 0 ? `${((retryTotal - retryIn) / retryTotal) * 100}%` : "0%" }}
          />
        </div>
        <p className="text-muted-subtle text-xs mt-4">Your progress is saved — no need to do anything.</p>
      </div>
    </div>
  );
};
```

- [ ] **Step 6.2: Create `PreScanOverlay`**

```typescript
// src/components/map/pre-scan-overlay.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import NextImage from "next/image";
import { formatEstimate } from "@/lib/format";
import { timeAgo } from "@/lib/format";
import type { TimeEstimate } from "@/lib/format";
import type { ScanStatus } from "@/hooks/useScanController";

const TOKEN_REQUIRED_STARS = 50_000;

type RepoInfo = {
  name: string;
  description: string | null;
  avatar: string | null;
};

type Props = {
  status: ScanStatus;
  cacheCheckDone: boolean;
  repoInfo: RepoInfo;
  estimate: TimeEstimate;
  total: number;
  lastDbScan: string | null;
  hasToken: boolean;
  /**
   * Pre-resolved by page.tsx: either startScraping or handleStartScan
   * depending on repo size and token state. PreScanOverlay does not re-implement the logic.
   */
  onStart: () => void;
};

export const PreScanOverlay = ({
  status, cacheCheckDone, repoInfo, estimate,
  total, lastDbScan, hasToken, onStart,
}: Props) => {
  if (status !== "idle" || !cacheCheckDone || !estimate) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prescan-title"
        className="bg-surface border border-border rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          {repoInfo.avatar && (
            <NextImage src={repoInfo.avatar} alt="" width={40} height={40} sizes="40px" className="w-10 h-10 rounded-full" />
          )}
          <div>
            <h2 id="prescan-title" className="text-foreground font-semibold">{repoInfo.name}</h2>
            {repoInfo.description && (
              <div className="text-muted text-xs mt-0.5 line-clamp-1">{repoInfo.description}</div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <div className="flex-1 bg-background rounded-lg px-4 py-3 text-center">
            <div className="text-2xl font-bold text-foreground">{total.toLocaleString()}</div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">stars</div>
          </div>
          <div className="flex-1 bg-background rounded-lg px-4 py-3 text-center">
            <div className="text-2xl font-bold text-accent-blue">{formatEstimate(estimate)}</div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">estimated</div>
          </div>
        </div>

        {estimate.keepOpen && (
          <div className="flex items-start gap-2.5 bg-warning-subtle border border-accent-orange/30 rounded-lg px-4 py-3 mb-6">
            <span className="text-accent-orange mt-0.5 flex-shrink-0">⚠</span>
            <p className="text-accent-orange text-xs leading-relaxed">
              Keep this tab open during indexing. Closing it will restart from scratch.
              {estimate.unit === "h" && " Consider running this overnight."}
            </p>
          </div>
        )}

        {lastDbScan ? (
          <div className="flex items-center gap-2 bg-background border border-accent-green-emphasis/40 rounded-lg px-4 py-2.5 mb-6">
            <span className="text-accent-green text-xs">✓ Last scanned {timeAgo(new Date(lastDbScan).getTime())}</span>
            <span className="text-border text-xs">·</span>
            <span className="text-muted-subtle text-xs">Results shared with other users</span>
          </div>
        ) : (
          <p className="text-muted text-xs mb-6 leading-relaxed">
            Stargazers are geocoded via their GitHub location field.
            Results are cached and shared — subsequent visitors load instantly.
          </p>
        )}

        {total >= TOKEN_REQUIRED_STARS && !hasToken && (
          <div className="flex items-start gap-2.5 bg-accent-orange/10 border border-accent-orange/30 rounded-lg px-4 py-3 mb-6">
            <span className="text-accent-orange mt-0.5 flex-shrink-0 text-sm">⚠</span>
            <div>
              <p className="text-accent-orange text-xs font-medium mb-1">
                A GitHub token is required for repos over 50,000 stars
              </p>
              <p className="text-muted text-xs leading-relaxed mb-2.5">
                Without a token, GitHub limits requests to 60/hr — not enough to index this repo.
                A free token unlocks 5,000/hr. No special permissions needed.
              </p>
              <button type="button" onClick={onStart} className="text-xs text-accent-blue hover:underline font-medium">
                Add your GitHub token →
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onStart}
          disabled={total >= TOKEN_REQUIRED_STARS && !hasToken}
          className={`w-full bg-accent-green-emphasis text-white font-medium py-3 rounded-lg transition-colors text-sm ${
            total >= TOKEN_REQUIRED_STARS && !hasToken ? "opacity-40 cursor-not-allowed" : "hover:opacity-90"
          }`}
        >
          {lastDbScan ? `Rescan ${total.toLocaleString()} stars →` : `Start indexing ${total.toLocaleString()} stars →`}
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 6.3: Update page.tsx**

Add imports:
```typescript
import { RateLimitOverlay } from "@/components/map/rate-limit-overlay";
import { PreScanOverlay } from "@/components/map/pre-scan-overlay";
```

Replace the `{/* Pre-scan overlay */}` block (lines ~677-766) with:
```tsx
<PreScanOverlay
  status={status}
  cacheCheckDone={cacheCheckDone}
  repoInfo={repoInfo}
  estimate={estimate}
  total={total}
  lastDbScan={lastDbScan}
  hasToken={hasToken}
  onStart={lastDbScan ? handleStartScan : (total >= TOKEN_REQUIRED_STARS ? handleStartScan : startScraping)}
/>
```

Replace the `{/* Rate limit overlay */}` block (lines ~768-814) with:
```tsx
<RateLimitOverlay
  status={status}
  waitReason={waitReason}
  retryIn={retryIn}
  retryTotal={retryTotal}
/>
```

- [ ] **Step 6.4: Remove the `TOKEN_REQUIRED_STARS` constant from page.tsx top** if no longer used there (it's now defined in `PreScanOverlay`). Check with:

```bash
grep -n "TOKEN_REQUIRED_STARS" src/app/\[owner\]/\[repo\]/page.tsx
```

If it appears only for the `PreScanOverlay` call site, remove the const from page.tsx and import from the component or duplicate inline. If it appears elsewhere, keep it.

- [ ] **Step 6.5: TypeScript check + commit**

```bash
rtk tsc
git add src/components/map/rate-limit-overlay.tsx src/components/map/pre-scan-overlay.tsx src/app/[owner]/[repo]/page.tsx
git commit -m "refactor(map-page): extract RateLimitOverlay + PreScanOverlay (#50)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `ShareModal`

**Files:**
- Create: `src/components/map/share-modal.tsx`
- Modify: `src/app/[owner]/[repo]/page.tsx`

- [ ] **Step 7.1: Create the component**

```typescript
// src/components/map/share-modal.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useCallback } from "react";
import NextImage from "next/image";
import { Modal } from "@/components/modal";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";
import type { MapProjection } from "@/lib/theme";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  avatar: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  repoInfo: RepoInfo;
  points: StargazerPoint[];
  displayStats: RepoStats | null;
  captureCanvas: () => Promise<string | null>;
  buildFilteredUrl: () => string;
  filterCountry: string;
  filterCity: string;
  filterCompany: string;
  filterFollowers: number;
  filterDate: "all" | "30d" | "90d" | "1y";
  followerMapFilter: "all" | "high" | "mid" | "low";
  viewMode: "clusters" | "heatmap";
  mapProjection: MapProjection;
  liDraft: string;
  onLiDraftChange: (s: string) => void;
};

export const ShareModal = ({
  open, onClose, owner, repo, repoInfo, points, displayStats,
  captureCanvas, buildFilteredUrl,
  filterCountry, filterCity, filterCompany, filterFollowers,
  filterDate, followerMapFilter, viewMode, mapProjection,
  liDraft, onLiDraftChange,
}: Props) => {
  const [liPanelOpen, setLiPanelOpen] = useState(false);
  const [liCopied, setLiCopied] = useState(false);
  const [badgeCopied, setBadgeCopied] = useState(false);
  const [filterLinkCopied, setFilterLinkCopied] = useState(false);

  const hasActiveFilters = !!(
    filterCountry || filterCity || filterCompany ||
    filterFollowers > 0 || filterDate !== "all" ||
    followerMapFilter !== "all" || viewMode !== "clusters"
  );

  const handleDownload = useCallback(async () => {
    const dataUrl = await captureCanvas();
    if (!dataUrl) return;
    const mapImg = new Image();
    await new Promise<void>((res) => { mapImg.onload = () => res(); mapImg.src = dataUrl; });
    const W = mapImg.naturalWidth, H = mapImg.naturalHeight;
    const S = W / 1440;

    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const ctx = out.getContext("2d")!;

    ctx.drawImage(mapImg, 0, 0);

    const panelW = Math.round(360 * S);
    const panelX = Math.round((W - panelW) / 2);
    const panelY = Math.round(20 * S);
    const pad = Math.round(20 * S);
    const avatarSize = Math.round(32 * S);
    const boxH = Math.round(66 * S);
    const tagsH = displayStats?.topCountries.length ? Math.round(34 * S) : 0;
    const footerH = Math.round(28 * S);
    const panelH = pad + avatarSize + Math.round(12 * S) + boxH + tagsH + footerH + pad;

    ctx.fillStyle = "rgba(13,17,23,0.92)";
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, Math.round(12 * S));
    ctx.fill();
    ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1; ctx.stroke();

    if (repoInfo.avatar) {
      try {
        const img = new Image(); img.crossOrigin = "anonymous";
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = repoInfo.avatar!; });
        ctx.save();
        ctx.beginPath();
        ctx.arc(panelX + pad + avatarSize / 2, panelY + pad + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, panelX + pad, panelY + pad, avatarSize, avatarSize);
        ctx.restore();
      } catch { /* skip avatar on CORS error */ }
    }

    const nameSize = Math.round(13 * S);
    ctx.fillStyle = "#f0f6fc";
    ctx.font = `bold ${nameSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`${owner}/${repo}`, panelX + pad + avatarSize + Math.round(10 * S), panelY + pad + Math.round(nameSize * 0.85));

    const statsY = panelY + pad + avatarSize + Math.round(12 * S);
    const gap = Math.round(6 * S);
    const bW = Math.round((panelW - pad * 2 - gap * 2) / 3);
    const statsArr = [
      { v: repoInfo.stars, label: "★ STARS", color: "#ffa657" },
      { v: points.length, label: "MAPPED", color: "#58a6ff" },
      { v: displayStats?.countryCount ?? 0, label: "COUNTRIES", color: "#3fb950" },
    ];
    for (let i = 0; i < 3; i++) {
      const bx = panelX + pad + i * (bW + gap);
      ctx.fillStyle = "rgba(22,27,34,0.9)";
      ctx.beginPath(); ctx.roundRect(bx, statsY, bW, boxH, Math.round(8 * S)); ctx.fill();
      const valStr = statsArr[i].v >= 1000 ? `${(statsArr[i].v / 1000).toFixed(1)}k` : String(statsArr[i].v);
      const valSize = Math.round(20 * S);
      ctx.fillStyle = statsArr[i].color;
      ctx.font = `bold ${valSize}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(valStr, bx + bW / 2, statsY + Math.round(38 * S));
      ctx.fillStyle = "#484f58";
      ctx.font = `${Math.round(8 * S)}px -apple-system, sans-serif`;
      ctx.fillText(statsArr[i].label, bx + bW / 2, statsY + Math.round(54 * S));
    }

    if (displayStats?.topCountries.length) {
      const tagsY = statsY + boxH + Math.round(8 * S);
      let tagX = panelX + pad;
      const tSize = Math.round(9 * S);
      ctx.font = `${tSize}px -apple-system, sans-serif`;
      for (const [country, count] of displayStats.topCountries.slice(0, 3)) {
        const text = `${country} · ${count}`;
        const tw = ctx.measureText(text).width + Math.round(14 * S);
        const tH = Math.round(20 * S);
        ctx.fillStyle = "rgba(13,17,23,0.8)";
        ctx.beginPath(); ctx.roundRect(tagX, tagsY, tw, tH, Math.round(5 * S)); ctx.fill();
        ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#8b949e"; ctx.textAlign = "left";
        ctx.fillText(text, tagX + Math.round(7 * S), tagsY + Math.round(14 * S));
        tagX += tw + Math.round(6 * S);
      }
    }

    ctx.fillStyle = "rgba(13,17,23,0.75)";
    const brandY = H - Math.round(28 * S);
    ctx.fillRect(0, brandY, Math.round(160 * S), Math.round(28 * S));
    ctx.fillStyle = "#58a6ff";
    ctx.font = `${Math.round(11 * S)}px -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("🌍 starmapper.bruniaux.com", Math.round(12 * S), brandY + Math.round(18 * S));

    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `starmapper-${owner}-${repo}.png`;
      a.click();
    }, "image/png");
  }, [captureCanvas, owner, repo, repoInfo, points, displayStats]);

  if (!open) return null;

  const starsLabel = repoInfo.stars >= 1000
    ? `${(repoInfo.stars / 1000).toFixed(1)}k`
    : repoInfo.stars;

  return (
    <Modal open={open} onClose={onClose} title="Share" maxWidth="max-w-lg">
      {/* Preview card */}
      <div id="share-card" className="mx-5 my-4 bg-background rounded-xl p-6 border border-border">
        <div className="flex items-center gap-3 mb-4">
          {repoInfo.avatar && <NextImage src={repoInfo.avatar} alt="" width={40} height={40} sizes="40px" className="w-10 h-10 rounded-full border border-border flex-shrink-0" />}
          <div className="min-w-0">
            <div className="text-muted text-xs leading-tight">{owner}</div>
            <div className="text-foreground font-bold text-base leading-tight truncate">{repo}</div>
            {repoInfo.description && <div className="text-muted text-xs mt-1 line-clamp-1">{repoInfo.description}</div>}
          </div>
        </div>
        <div className="flex gap-4 mb-4">
          <div className="flex-1 bg-surface rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-accent-orange">{repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars}</div>
            <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">★ stars</div>
          </div>
          <div className="flex-1 bg-surface rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-accent-blue">{points.length.toLocaleString()}</div>
            <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">mapped</div>
          </div>
          {displayStats && (
            <div className="flex-1 bg-surface rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-accent-green">{displayStats.countryCount}</div>
              <div className="text-2xs text-muted-subtle uppercase tracking-wide mt-0.5">countries</div>
            </div>
          )}
        </div>
        {displayStats?.topCountries.slice(0, 3).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {displayStats.topCountries.slice(0, 3).map(([country, count]) => (
              <span key={country} className="text-xs bg-surface border border-border rounded px-2 py-1 text-muted">
                {country} · {count}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-border-subtle flex items-center justify-between">
          <span className="text-2xs text-muted-subtle"><span aria-hidden="true">🌍</span> starmapper.bruniaux.com</span>
          <span className="text-2xs text-muted-subtle">+ live map in download</span>
        </div>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-3">
        <div className="flex gap-3">
          <button
            onClick={() => { navigator.clipboard.writeText(window.location.href).catch(() => {}); }}
            className="flex-1 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-sm py-2 rounded-lg transition-colors"
          >
            Copy link
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 bg-accent-green-emphasis hover:opacity-90 text-white text-sm py-2 rounded-lg transition-opacity font-medium"
          >
            ↓ Download PNG
          </button>
        </div>

        {/* Social share */}
        <div className="flex gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${displayStats?.countryCount ?? "?"} countries!`)}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-2 rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
            Share on X
          </a>
          <button
            onClick={() => {
              onLiDraftChange(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${displayStats?.countryCount ?? "?"} countries!\n\n${typeof window !== "undefined" ? window.location.href : ""}`);
              setLiCopied(false);
              setLiPanelOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-2 rounded-lg transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            Share on LinkedIn
          </button>

          {/* LinkedIn pre-share panel */}
          {liPanelOpen && (
            <div className="absolute inset-0 z-10 rounded-xl bg-background border border-border flex flex-col p-4 gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Your LinkedIn post</span>
                <button onClick={() => setLiPanelOpen(false)} aria-label="Close LinkedIn post" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">×</span></button>
              </div>
              <textarea
                value={liDraft}
                onChange={(e) => onLiDraftChange(e.target.value)}
                rows={5}
                aria-label="LinkedIn post draft"
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-foreground resize-none focus:outline-none focus:border-accent-blue"
              />
              <p className="text-2xs text-muted-subtle">LinkedIn doesn&apos;t allow pre-filled text. Copy this post, then paste it after clicking below.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(liDraft).catch(() => {});
                    setLiCopied(true);
                    setTimeout(() => setLiCopied(false), 3000);
                  }}
                  className={`flex-1 bg-surface-alt border border-border text-xs py-2 rounded-lg transition-colors hover:bg-border ${liCopied ? "text-accent-green" : "text-muted"}`}
                >
                  {liCopied ? "✓ Copied!" : "Copy text"}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(liDraft).catch(() => {});
                    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`, "_blank", "noopener,noreferrer");
                    setLiPanelOpen(false);
                  }}
                  className="flex-1 bg-[#0a66c2] hover:bg-[#0856a5] text-white text-xs py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-1.5"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  Post on LinkedIn →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* README badge */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle">
            <span className="text-foreground text-xs font-medium">README badge</span>
          </div>
          <div className="bg-surface-alt px-3 py-2">
            <code className="text-muted text-xs break-all select-all leading-relaxed whitespace-pre-wrap">
              {typeof window !== "undefined"
                ? `<a href="${window.location.origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${window.location.origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                : ""}
            </code>
          </div>
          <div className="px-3 py-2 border-t border-border-subtle">
            <button
              onClick={() => {
                const origin = window.location.origin;
                const html = `<a href="${origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`;
                navigator.clipboard.writeText(html).catch(() => {});
                setBadgeCopied(true);
                setTimeout(() => setBadgeCopied(false), 2000);
              }}
              className="w-full flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-1.5 rounded-md transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {badgeCopied ? "Copied ✓" : "Copy HTML"}
            </button>
          </div>
        </div>

        {/* Current view deep link */}
        {hasActiveFilters && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
              <span className="text-foreground text-xs font-medium">Current view</span>
              <div className="flex flex-wrap gap-1">
                {filterCountry && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCountry}</span>}
                {filterCity && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCity}</span>}
                {filterCompany && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterCompany}</span>}
                {filterFollowers > 0 && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterFollowers}+ flw</span>}
                {filterDate !== "all" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{filterDate}</span>}
                {followerMapFilter !== "all" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{followerMapFilter}</span>}
                {viewMode !== "clusters" && <span className="text-2xs bg-surface border border-border-subtle rounded px-1.5 py-0.5 text-muted">{viewMode}</span>}
              </div>
            </div>
            <div className="px-3 py-2 flex items-center gap-2">
              <code className="flex-1 text-xs text-muted truncate">
                {typeof window !== "undefined" ? buildFilteredUrl().replace(/^https?:\/\//, "") : ""}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildFilteredUrl()).catch(() => {});
                  setFilterLinkCopied(true);
                  setTimeout(() => setFilterLinkCopied(false), 2000);
                }}
                className="flex-shrink-0 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs px-3 py-1.5 rounded-md transition-colors"
              >
                {filterLinkCopied ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
```

- [ ] **Step 7.2: Update page.tsx**

**Add import:**
```typescript
import { ShareModal } from "@/components/map/share-modal";
```

**Add `liDraft` state** (the only state migrating OUT of the inline block that must stay in page.tsx):
```typescript
const [liDraft, setLiDraft] = useState("");
```

**Remove** inline state declarations that migrate into ShareModal (if not already removed by earlier tasks):
```typescript
// REMOVE from page.tsx:
const [liPanelOpen, setLiPanelOpen] = useState(false);
const [liCopied, setLiCopied] = useState(false);
const [badgeCopied, setBadgeCopied] = useState(false);
const [filterLinkCopied, setFilterLinkCopied] = useState(false);
// Keep: liDraft (controlled prop), shareOpen
```

**Replace** the entire `{/* Share modal */}` block (lines ~1039-1350) with:
```tsx
{repoInfo && (
  <ShareModal
    open={shareOpen}
    onClose={() => setShareOpen(false)}
    owner={owner}
    repo={repo}
    repoInfo={repoInfo}
    points={points}
    displayStats={displayStats}
    captureCanvas={() => mapControlsRef.current?.captureCanvas() ?? Promise.resolve(null)}
    buildFilteredUrl={buildFilteredUrl}
    filterCountry={filterCountry}
    filterCity={filterCity}
    filterCompany={filterCompany}
    filterFollowers={filterFollowers}
    filterDate={filterDate}
    followerMapFilter={followerMapFilter}
    viewMode={viewMode}
    mapProjection={mapProjection}
    liDraft={liDraft}
    onLiDraftChange={setLiDraft}
  />
)}
```

- [ ] **Step 7.3: TypeScript check + line count**

```bash
rtk tsc
wc -l src/app/\[owner\]/\[repo\]/page.tsx
```

Expected: no new errors, line count ≤ 700.

- [ ] **Step 7.4: Run all tests**

```bash
rtk vitest run
```

Expected: 0 failures, new tests all green.

- [ ] **Step 7.5: Commit + close issue**

```bash
git add src/components/map/share-modal.tsx src/app/[owner]/[repo]/page.tsx
git commit -m "refactor(map-page): extract ShareModal — page.tsx ≤700 lines, closes #50

- ShareModal owns liPanelOpen, liCopied, badgeCopied, filterLinkCopied
- liDraft passes as controlled prop (draft persists across open/close)
- captureCanvas passed as callback (not RefObject)
- aria-label added to LinkedIn textarea

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
gh issue close 50 --repo FlorianBruniaux/starmapper --comment "Closed by final commit. page.tsx ≤700 lines after 7 extractions across phases 1-3."
```
