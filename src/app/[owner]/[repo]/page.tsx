// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useEffect, useRef, useState, useCallback, useMemo, useDeferredValue, useReducer, startTransition } from "react";
import NextImage from "next/image";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { MapFloatingNav } from "@/components/map/map-floating-nav";
import { CLUSTER_RADIUS } from "@/components/map/constants";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";
import type { MapProjection } from "@/lib/theme";
import type { RepoStats, RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import { TokenModal, getStoredToken, getStoredUsername, setStoredUsername } from "@/components/token-modal";
import { Modal } from "@/components/modal";
import { saveBookmark } from "@/lib/bookmarks";
import { FilterCombobox } from "@/components/filter-combobox";
import { isCountry, normalizeCountry } from "@/lib/countries";
import { StatsList } from "@/components/stats-list";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { compressToBase64 } from "@/lib/compress-client";
import { TopPanel } from "@/components/map/top-panel";
import { Dock } from "@/components/map/dock";
import { TimelapseBar } from "@/components/map/timelapse-bar";
import type { TimelapseSpeed } from "@/components/map/timelapse-bar";
import { formatEstimate, timeAgo } from "@/lib/format";
import type { TimeEstimate } from "@/lib/format";

type AnyStargazer = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  followers: number;
  location: string | null;
  avatarUrl: string | null;
  mapped: boolean;
  starredAt: string | null;
  // enriched via /api/user-details (optional — present after fetch)
  email?: string | null;
  blog?: string | null;
  twitter_username?: string | null;
};

type SortKey = "followers" | "login" | "location" | "starredAt" | "company";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
};

type LocalCache = {
  version: 1;
  points: StargazerPoint[];
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[];
  totalCount: number;
  scannedAt: number; // ms timestamp
  latestStarredAt: string | null; // ISO timestamp of most recent star
}

const cacheKey = (owner: string, repo: string) => `starmapper:${owner}/${repo}`;

const loadCache = (owner: string, repo: string): LocalCache | null => {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo));
    if (!raw) return null;
    const c = JSON.parse(raw) as LocalCache;
    return c.version === 1 ? c : null;
  } catch {
    return null;
  }
};

const saveCache = (owner: string, repo: string, data: Omit<LocalCache, "version">) => {
  try {
    localStorage.setItem(cacheKey(owner, repo), JSON.stringify({ version: 1, ...data }));
  } catch {
    // localStorage quota exceeded — non-fatal
  }
};

const clearCache = (owner: string, repo: string) => {
  try { localStorage.removeItem(cacheKey(owner, repo)); } catch { /* ignore */ }
};

const TOKEN_REQUIRED_STARS = 50_000;

const estimateScan = (stars: number): TimeEstimate => {
  const locationsToGeocode = Math.round(stars * 0.4 * 0.7);
  const geocodeSeconds = locationsToGeocode * 0.2;
  const githubSeconds = Math.ceil(stars / 100);
  const totalSeconds = geocodeSeconds + githubSeconds;

  const minS = Math.max(5, Math.round(totalSeconds * 0.6));
  const maxS = Math.round(totalSeconds * 1.5);

  if (maxS < 90) return { min: minS, max: maxS, unit: "sec", keepOpen: false };
  if (maxS < 3600) return { min: Math.round(minS / 60), max: Math.round(maxS / 60), unit: "min", keepOpen: maxS > 300 };
  return { min: Math.round(minS / 3600 * 10) / 10, max: Math.round(maxS / 3600 * 10) / 10, unit: "h", keepOpen: true };
}


class RateLimitedError extends Error {
  resetAt: number; // ms epoch
  reason: "github" | "server";
  constructor(resetAt: number, reason: "github" | "server" = "server") {
    super("rate_limited");
    this.resetAt = resetAt;
    this.reason = reason;
  }
}

type UnmappedEntry = { login: string; name: string | null; followers: number; starredAt: string | null };

type ScanState = {
  points: StargazerPoint[];
  unmapped: UnmappedEntry[];
  processed: number;
};

type ScanAction =
  | { type: "reset" }
  | { type: "set"; points: StargazerPoint[]; unmapped: UnmappedEntry[] }
  | { type: "chunk"; points: StargazerPoint[]; unmapped: UnmappedEntry[] };

const scanReducer = (state: ScanState, action: ScanAction): ScanState => {
  switch (action.type) {
    case "reset":
      return { points: [], unmapped: [], processed: 0 };
    case "set":
      return { points: action.points, unmapped: action.unmapped, processed: action.points.length + action.unmapped.length };
    case "chunk":
      return { points: action.points, unmapped: action.unmapped, processed: action.points.length + action.unmapped.length };
    default:
      return state;
  }
};

export default function MapPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = use(params);
  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [scan, dispatch] = useReducer(scanReducer, { points: [], unmapped: [], processed: 0 });
  const { points, unmapped, processed } = scan;
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "waiting" | "done" | "cached" | "refreshing" | "error">("idle");

  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [retryIn, setRetryIn] = useState(0);
  const [retryTotal, setRetryTotal] = useState(0);
  const [waitReason, setWaitReason] = useState<"github" | "server">("server");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [findInput, setFindInput] = useState("");
  const [findStatus, setFindStatus] = useState<"idle" | "searching" | "found" | "no-location" | "not-found">("idle");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [lastDbScan, setLastDbScan] = useState<string | null>(null);
  const [latestStarredAt, setLatestStarredAt] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<RepoStats | null>(null);
  const [organicData, setOrganicData] = useState<RepoOrganic | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsTab, setStatsTab] = useState<"countries" | "cities" | "top" | "companies" | "power">("top");
  const [statsFilter, setStatsFilter] = useState("");
  const [statsTopSort, setStatsTopSort] = useState<"followers" | "repos">("followers");
  const [shareOpen, setShareOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [badgeTab, setBadgeTab] = useState<"map" | "shield">("map");
  const [liPanelOpen, setLiPanelOpen] = useState(false);
  const [liDraft, setLiDraft] = useState("");
  const [liCopied, setLiCopied] = useState(false);
  const [badgeCopied, setBadgeCopied] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [allSearch, setAllSearch] = useState("");
  const deferredSearch = useDeferredValue(allSearch);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableVisibleCount, setTableVisibleCount] = useState(14);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [allSort, setAllSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "followers", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const csvEnabled = process.env.NEXT_PUBLIC_CSV_EXPORT === "true";
  const [filterFollowers, setFilterFollowers] = useState(0);
  const [filterMapped, setFilterMapped] = useState<"all" | "mapped" | "unmapped">("all");
  const [followerMapFilter, setFollowerMapFilter] = useState<"all" | "high" | "mid" | "low">("all");
  const [clusterRadius, setClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [debouncedClusterRadius, setDebouncedClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [filterDate, setFilterDate] = useState<"all" | "30d" | "90d" | "1y">("all");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; login: string } | null>(null);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [storedUsername, setStoredUsernameState] = useState("");
  const [repoNotFound, setRepoNotFound] = useState(false);
  const [repoRateLimited, setRepoRateLimited] = useState(false);
  const [cacheCheckDone, setCacheCheckDone] = useState(false);
  const mapControlsRef = useRef<{
    captureCanvas: () => Promise<string | null>;
    setViewMode: (mode: "clusters" | "heatmap") => void;
    toggleProjection: () => MapProjection;
    getProjection: () => MapProjection;
  } | null>(null);
  const [mapProjection, setMapProjection] = useState<MapProjection>("globe");
  const [viewMode, setViewMode] = useState<"clusters" | "heatmap">("clusters");
  const runningRef = useRef(false);
  const pendingScanRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  // Timelapse state
  const [timelapseActive, setTimelapseActive] = useState(false);
  const [timelapseIndex, setTimelapseIndex] = useState(0);
  const [timelapseAutoPlay, setTimelapseAutoPlay] = useState(false);
  const [timelapseSpeed, setTimelapseSpeed] = useState<TimelapseSpeed>(800);

  // Compare repo state
  const [compareOwner, setCompareOwner] = useState<string | null>(null);
  const [compareRepo, setCompareRepo] = useState<string | null>(null);
  const [comparePoints, setComparePoints] = useState<StargazerPoint[]>([]);
  const [compareStatus, setCompareStatus] = useState<"idle" | "loading" | "done">("idle");
  const [compareInfo, setCompareInfo] = useState<RepoInfo | null>(null);
  const compareRunningRef = useRef(false);

  // Debounce clusterRadius changes — map rebuild fires 150ms after slider stops
  useEffect(() => {
    const t = setTimeout(() => setDebouncedClusterRadius(clusterRadius), 150);
    return () => clearTimeout(t);
  }, [clusterRadius]);

  // Read compare param from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("compare");
    if (p && p.includes("/") && p.split("/").length === 2) {
      const [o, r] = p.split("/");
      if (o && r) {
        setCompareOwner(o);
        setCompareRepo(r);
      }
    }
  }, []);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  // Sync localStorage state client-side (not available during SSR)
  useEffect(() => {
    setHasToken(!!getStoredToken());
    setStoredUsernameState(getStoredUsername());
  }, []);

  // Track repo view — fire-and-forget
  useEffect(() => {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "repo", slug: `${owner}/${repo}` }),
    }).catch(() => {});
  }, [owner, repo]);

  // Load repo info
  useEffect(() => {
    const t = getStoredToken();
    fetch(`/api/repo-info?owner=${owner}&repo=${repo}`, {
      headers: t ? { "x-gh-token": t } : {},
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401 || r.status === 429) { setRepoRateLimited(true); return; }
        if (!r.ok || data.error) { setRepoNotFound(true); return; }
        setRepoInfo(data);
        setTotal((t2) => t2 || data.stars);
      })
      .catch(() => { setRepoNotFound(true); });
  }, [owner, repo]);

  // Load from localStorage cache on mount
  useEffect(() => {
    const cache = loadCache(owner, repo);
    if (!cache) return;
    dispatch({ type: "set", points: cache.points, unmapped: cache.unmapped });
    setTotal(cache.totalCount);
    setCachedAt(cache.scannedAt);
    setLatestStarredAt(cache.latestStarredAt);
    setStatus("cached");
    saveBookmark(owner, repo, cache.totalCount);

    // Sync badge_cache from localStorage (repos scanned before badge-update existed)
    const countrySet = new Set(
      cache.points
        .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
        .filter(Boolean),
    );
    fetch("/api/badge-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        repo,
        mappedCount: cache.points.length,
        countryCount: countrySet.size,
        totalCount: cache.totalCount,
        ...(repoInfo?.forksCount !== undefined && { forksCount: repoInfo.forksCount }),
        ...(repoInfo?.watchersCount !== undefined && { watchersCount: repoInfo.watchersCount }),
      }),
    })
      .then(() => fetch(`/api/stats/${owner}/${repo}`))
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setServerStats(data); })
      .catch(() => {});
  }, [owner, repo]);

  // Check DB cache on mount — falls back to badge_cache metadata (last scan date)
  useEffect(() => {
    if (loadCache(owner, repo)) { setCacheCheckDone(true); return; } // localStorage takes priority
    fetch(`/api/stargazer-cache/${owner}/${repo}`)
      .then(async (r) => {
        if (r.status === 206) {
          const d = await r.json();
          setLastDbScan(d.lastScan);
          return;
        }
        if (!r.ok) return;
        const data = await r.json();
        if (!data.points) return;
        const scannedMs = new Date(data.scannedAt).getTime();
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
  }, [owner, repo]);

  // Fetch server-side stats from DB (fallback for repos not in StargazerCache, or >15k stars)
  useEffect(() => {
    fetch(`/api/stats/${owner}/${repo}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: RepoStats | null) => { if (data) setServerStats(data); })
      .catch(() => {});
  }, [owner, repo]);

  // Fetch organic score independently — reads badge_cache directly, no star_event dependency
  useEffect(() => {
    fetch(`/api/organic-score/${owner}/${repo}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { organic: RepoOrganic } | null) => { if (data?.organic) setOrganicData(data.organic); })
      .catch(() => {});
  }, [owner, repo]);

  // Countdown ticker when waiting
  useEffect(() => {
    if (status !== "waiting" || retryIn <= 0) return;
    const t = setTimeout(() => setRetryIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [status, retryIn]);

  const fetchNextChunk = useCallback(async (cursor: string | null, since?: string) => {
    const res = await fetch("/api/chunk", {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ owner, repo, cursor, since }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as { resetAt?: number };
      // resetAt present = GitHub rate limit; absent = server concurrent limit
      throw new RateLimitedError(body.resetAt ?? Date.now() + 60_000, body.resetAt ? "github" : "server");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ChunkResponse;
  }, [owner, repo]);

  // Full scan from scratch
  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    clearCache(owner, repo);
    dispatch({ type: "reset" });
    setStatus("loading");
    let cursor: string | null = null;
    let allPoints: StargazerPoint[] = [];
    let allUnmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[] = [];
    let newestStarredAt: string | null = null;

    try {
      while (true) {
        let chunk: ChunkResponse;
        while (true) {
          try {
            chunk = await fetchNextChunk(cursor);
            break;
          } catch (e) {
            if (e instanceof RateLimitedError) {
              const secsLeft = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000));
              setWaitReason(e.reason);
              setStatus("waiting");
              setRetryIn(secsLeft);
              setRetryTotal(secsLeft);
              await new Promise((r) => setTimeout(r, secsLeft * 1000));
              setStatus("loading");
            } else {
              throw e;
            }
          }
        }

        if (!newestStarredAt && chunk!.latestStarredAt) newestStarredAt = chunk!.latestStarredAt;
        setTotal(chunk!.totalCount); // urgent — drives progress bar
        // Spread into new arrays — new references trigger memo() re-render and the throttled
        // setData effect in StargazerMap. Mutation in place would keep same reference →
        // memo() bails out → useEffect([points]) never fires → map frozen after chunk 1.
        allPoints = [...allPoints, ...chunk!.points];
        allUnmapped = [...allUnmapped, ...chunk!.unmapped];
        startTransition(() => {
          dispatch({ type: "chunk", points: allPoints, unmapped: allUnmapped });
        });
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      const now = Date.now();
      setCachedAt(now);
      setLatestStarredAt(newestStarredAt);
      saveCache(owner, repo, {
        points: allPoints,
        unmapped: allUnmapped,
        totalCount: allPoints.length + allUnmapped.length,
        scannedAt: now,
        latestStarredAt: newestStarredAt,
      });
      saveBookmark(owner, repo, allPoints.length + allUnmapped.length);

      // Update badge cache (fire-and-forget)
      const countrySet = new Set(
        allPoints
          .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
          .filter(Boolean),
      );
      fetch("/api/badge-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          mappedCount: allPoints.length,
          countryCount: countrySet.size,
          totalCount: allPoints.length + allUnmapped.length,
          language: repoInfo?.language ?? null,
          ...(repoInfo?.forksCount !== undefined && { forksCount: repoInfo.forksCount }),
          ...(repoInfo?.watchersCount !== undefined && { watchersCount: repoInfo.watchersCount }),
        }),
      })
        .then(() => fetch(`/api/stats/${owner}/${repo}`))
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data) setServerStats(data); })
        .catch(() => {});

      // Save to DB cache (shared across users, fire-and-forget).
      // Compress client-side first to stay under Vercel's 4.5MB request body limit —
      // raw JSON for large repos (e.g. 50k stars) exceeds that limit without compression.
      const finalTotal = allPoints.length + allUnmapped.length;
      if (finalTotal > 0) {
        (async () => {
          try {
            type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
            const slim: SlimPoint[] = allPoints.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
            const [pointsGz, unmappedGz] = await Promise.all([
              compressToBase64(slim),
              compressToBase64(allUnmapped),
            ]);
            await fetch("/api/stargazer-cache", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount: finalTotal, latestStarredAt: newestStarredAt, ts: Date.now() }),
            });
          } catch { /* fire-and-forget, non-critical */ }
        })();
      }

      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [fetchNextChunk, owner, repo, total]);

  // Delta scan — only fetch stars newer than latestStarredAt
  const startRefresh = useCallback(async () => {
    if (runningRef.current || !latestStarredAt) return;
    runningRef.current = true;
    setStatus("refreshing");
    let cursor: string | null = null;
    let newPoints: StargazerPoint[] = [];
    let newUnmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[] = [];
    let newestStarredAt: string | null = null;
    let latestTotalCount = total;

    try {
      while (true) {
        let chunk: ChunkResponse;
        while (true) {
          try {
            chunk = await fetchNextChunk(cursor, latestStarredAt);
            break;
          } catch (e) {
            if (e instanceof RateLimitedError) {
              const secsLeft = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000));
              setWaitReason(e.reason);
              setStatus("waiting");
              setRetryIn(secsLeft);
              setRetryTotal(secsLeft);
              await new Promise((r) => setTimeout(r, secsLeft * 1000));
              setStatus("refreshing");
            } else {
              throw e;
            }
          }
        }

        if (!newestStarredAt && chunk!.latestStarredAt) newestStarredAt = chunk!.latestStarredAt;
        latestTotalCount = chunk!.totalCount;
        setTotal(chunk!.totalCount);
        newPoints.push(...chunk!.points);
        newUnmapped.push(...chunk!.unmapped);
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      const now = Date.now();
      // Merge new data using ref to get latest state (avoids stale closure)
      const current = scanRef.current;
      const existing = new Set(current.points.map((p) => p.login));
      const mergedPoints = [...newPoints.filter((p) => !existing.has(p.login)), ...current.points];
      const mergedUnmapped = [...newUnmapped, ...current.unmapped];
      startTransition(() => {
        dispatch({ type: "set", points: mergedPoints, unmapped: mergedUnmapped });
      });
      setCachedAt(now);

      const updatedLatest = newestStarredAt ?? latestStarredAt;
      setLatestStarredAt(updatedLatest);

      saveCache(owner, repo, {
        points: mergedPoints,
        unmapped: mergedUnmapped,
        totalCount: latestTotalCount,
        scannedAt: now,
        latestStarredAt: updatedLatest,
      });

      // Persist refreshed data to DB cache (fire-and-forget)
      if (mergedPoints.length > 0) {
        (async () => {
          try {
            type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
            const slim: SlimPoint[] = mergedPoints.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
            const [pointsGz, unmappedGz] = await Promise.all([
              compressToBase64(slim),
              compressToBase64(mergedUnmapped),
            ]);
            await fetch("/api/stargazer-cache", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount: latestTotalCount, latestStarredAt: updatedLatest, ts: now }),
            });
          } catch { /* fire-and-forget, non-critical */ }
        })();
      }

      setStatus("cached");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [fetchNextChunk, latestStarredAt, owner, repo, total]);

  // Require a GitHub token before starting a full scan
  const handleStartScan = useCallback(() => {
    if (!getStoredToken()) {
      pendingScanRef.current = true;
      setTokenOpen(true);
      return;
    }
    startScraping();
  }, [startScraping]);

  const handleStartRefresh = useCallback(() => {
    if (!getStoredToken()) {
      pendingRefreshRef.current = true;
      setTokenOpen(true);
      return;
    }
    startRefresh();
  }, [startRefresh]);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
    if (pendingScanRef.current) {
      pendingScanRef.current = false;
      if (getStoredToken()) startScraping();
    }
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      if (getStoredToken()) startRefresh();
    }
  }, [startScraping, startRefresh]);

  const startCompareScan = useCallback(async () => {
    if (!compareOwner || !compareRepo || compareRunningRef.current) return;
    compareRunningRef.current = true;
    setCompareStatus("loading");
    let cursor: string | null = null;
    const allPts: StargazerPoint[] = [];
    let lastCompareUpdate = 0;
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
        // Throttle: update compare state at most once every 2s during scan.
        const now = Date.now();
        if (now - lastCompareUpdate >= 2000) {
          setComparePoints([...allPts]);
          lastCompareUpdate = now;
        }
        if (!chunk.nextCursor) break;
        cursor = chunk.nextCursor;
      }
    } catch (e) {
      console.error("[compare] scan failed:", e);
      setCompareStatus("done");
      compareRunningRef.current = false;
      return;
    }
    // Always apply final state at end of scan
    setComparePoints([...allPts]);
    setCompareStatus("done");
    compareRunningRef.current = false;
  }, [compareOwner, compareRepo, ghHeaders]);

  useEffect(() => {
    if (!compareOwner || !compareRepo) return;
    const t = getStoredToken();
    fetch(`/api/repo-info?owner=${compareOwner}&repo=${compareRepo}`, {
      headers: t ? { "x-gh-token": t } : {},
    })
      .then((r) => r.json())
      .then((d: RepoInfo & { error?: string }) => { if (!d.error) setCompareInfo(d); })
      .catch(() => {});
    startCompareScan();
  }, [compareOwner, compareRepo, startCompareScan]);

  // Sync viewMode to map imperatively (no re-render)
  useEffect(() => {
    mapControlsRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  // Reset to clusters when compare mode activates
  useEffect(() => {
    if (compareOwner && compareRepo) setViewMode("clusters");
  }, [compareOwner, compareRepo]);

  const allStargazers = useMemo<AnyStargazer[]>(() => [
    ...points.map((p) => ({
      login: p.login, name: p.name, bio: p.bio, company: p.company,
      followers: p.followers, location: p.location ?? null,
      avatarUrl: p.avatarUrl, mapped: true, starredAt: p.starredAt ?? null,
    })),
    ...unmapped.map((u) => ({
      login: u.login, name: u.name, bio: null, company: null,
      followers: u.followers, location: null,
      avatarUrl: null, mapped: false, starredAt: u.starredAt ?? null,
    })),
  ], [points, unmapped]);

  // Deferred list — filter/sort recomputation runs at lower priority during scan (INP: F10)
  const deferredAllStargazers = useDeferredValue(allStargazers);

  // Month buckets for timelapse — sorted YYYY-MM strings derived from starredAt
  // Returns the YYYY-MM-DD of the Monday of the week containing dateStr (YYYY-MM-DD)
  const getWeekMonday = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDay(); // 0=Sun, 1=Mon, …
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    return d.toISOString().slice(0, 10);
  };

  // Weekly buckets — one entry per week (Monday YYYY-MM-DD) that has at least 1 star
  const weekBuckets = useMemo(() => {
    const weeks = new Set(
      points
        .filter((p) => p.starredAt)
        .map((p) => getWeekMonday(p.starredAt!.slice(0, 10))),
    );
    return [...weeks].sort();
  }, [points]);

  // Auto-play: advance one week per interval, stop at last
  useEffect(() => {
    if (!timelapseAutoPlay || !timelapseActive) return;
    const t = setInterval(() => {
      setTimelapseIndex((i) => {
        if (i >= weekBuckets.length - 1) {
          setTimelapseAutoPlay(false);
          return i;
        }
        return i + 1;
      });
    }, timelapseSpeed);
    return () => clearInterval(t);
  }, [timelapseAutoPlay, timelapseActive, weekBuckets.length, timelapseSpeed]);

  const filteredMapPoints = useMemo(() => {
    let result = points;
    if (followerMapFilter === "high") result = result.filter((p) => p.followers >= 500);
    else if (followerMapFilter === "mid") result = result.filter((p) => p.followers >= 100 && p.followers < 500);
    else if (followerMapFilter === "low") result = result.filter((p) => p.followers < 100);

    if (timelapseActive && weekBuckets.length > 0) {
      // Show stars up to and including the Sunday of the current week
      const monday = weekBuckets[timelapseIndex] ?? weekBuckets[0];
      const d = new Date(monday + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6); // Sunday
      const cutoff = d.toISOString().slice(0, 10);
      result = result.filter((p) => !p.starredAt || p.starredAt.slice(0, 10) <= cutoff);
    }

    return result;
  }, [points, followerMapFilter, timelapseActive, timelapseIndex, weekBuckets]);

  // Cheap boolean — used by Dock to show/hide the growth button
  const hasGrowthData = useMemo(
    () => [...points, ...unmapped].some((u) => !!u.starredAt),
    [points, unmapped],
  );

  // Expensive computation — only runs when drawer is open (INP: F2)
  const growthData = useMemo(() => {
    if (!growthOpen) return [];
    const all = [...points, ...unmapped].filter((u) => u.starredAt);
    if (all.length < 2) return [];
    const weekMap = new Map<string, number>();
    for (const u of all) {
      const d = new Date(u.starredAt!);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
    }
    return [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [growthOpen, points, unmapped]);

  const filteredStargazers = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    let list = deferredAllStargazers;
    if (q) list = list.filter((u) =>
      u.login.toLowerCase().includes(q) ||
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.location?.toLowerCase().includes(q) ?? false) ||
      (u.company?.toLowerCase().includes(q) ?? false) ||
      (u.bio?.toLowerCase().includes(q) ?? false)
    );
    if (filterFollowers > 0) list = list.filter((u) => u.followers >= filterFollowers);
    if (filterMapped === "mapped") list = list.filter((u) => u.mapped);
    if (filterMapped === "unmapped") list = list.filter((u) => !u.mapped);
    if (filterDate !== "all") {
      const days = filterDate === "30d" ? 30 : filterDate === "90d" ? 90 : 365;
      const cutoff = Date.now() - days * 86400000;
      list = list.filter((u) => u.starredAt && new Date(u.starredAt).getTime() >= cutoff);
    }
    if (filterCompany) list = list.filter((u) => u.company?.toLowerCase().includes(filterCompany.toLowerCase()));
    if (filterCountry) list = list.filter((u) => u.location?.toLowerCase().includes(filterCountry.toLowerCase()));
    if (filterCity) list = list.filter((u) => u.location?.toLowerCase().includes(filterCity.toLowerCase()));
    return [...list].sort((a, b) => {
      if (allSort.key === "followers") return (b.followers - a.followers) * allSort.dir;
      if (allSort.key === "login") return a.login.localeCompare(b.login) * allSort.dir;
      if (allSort.key === "starredAt") {
        const at = a.starredAt ? new Date(a.starredAt).getTime() : 0;
        const bt = b.starredAt ? new Date(b.starredAt).getTime() : 0;
        return (bt - at) * allSort.dir;
      }
      if (allSort.key === "company") return (a.company ?? "").localeCompare(b.company ?? "") * allSort.dir;
      const la = a.location ?? "";
      const lb = b.location ?? "";
      return la.localeCompare(lb) * allSort.dir;
    });
  }, [deferredAllStargazers, deferredSearch, allSort, filterFollowers, filterMapped, filterDate, filterCompany, filterCountry, filterCity]);

  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of allStargazers) {
      const raw = u.location?.split(",").pop()?.trim();
      if (raw && isCountry(raw)) {
        const c = normalizeCountry(raw);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([c]) => c);
  }, [allStargazers]);

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of allStargazers) {
      const parts = u.location?.split(",");
      if (parts && parts.length >= 2) {
        const c = parts[0]?.trim();
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([c]) => c);
  }, [allStargazers]);

  // Reset scroll to top whenever the filtered list changes (sort/filter/search)
  useEffect(() => {
    setTableScrollTop(0);
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
  }, [filteredStargazers]);

  // Virtual scroll: only render visible rows
  const TABLE_ROW_H = 40;
  const TABLE_OVERSCAN = 5;

  // Dynamic virtual scroll row count based on container height
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTableVisibleCount(Math.max(5, Math.ceil(el.clientHeight / TABLE_ROW_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [TABLE_ROW_H]);
  const tableVStart = Math.max(0, Math.floor(tableScrollTop / TABLE_ROW_H) - TABLE_OVERSCAN);
  const tableVEnd = Math.min(filteredStargazers.length, tableVStart + tableVisibleCount + TABLE_OVERSCAN * 2);
  const tableSlice = filteredStargazers.slice(tableVStart, tableVEnd);
  const tablePadTop = tableVStart * TABLE_ROW_H;
  const tablePadBottom = (filteredStargazers.length - tableVEnd) * TABLE_ROW_H;
  const isSearchPending = allSearch !== deferredSearch;

  const findUser = useCallback((loginOverride?: string) => {
    const raw = (loginOverride ?? findInput).trim();
    if (!raw) return;
    // Accept: https://github.com/login, github.com/login, or plain login
    const login = raw.replace(/^https?:\/\//i, "").replace(/^github\.com\//i, "").split("/")[0].toLowerCase();
    if (!login) return;
    setFindStatus("searching");
    setTimeout(() => {
      const mapped = points.find((p) => p.login.toLowerCase() === login);
      if (mapped) {
        setFlyTarget({ lat: mapped.lat, lng: mapped.lng, login: mapped.login });
        setFindStatus("found");
      } else {
        const inAll = allStargazers.find((u) => u.login.toLowerCase() === login);
        setFindStatus(inAll ? "no-location" : "not-found");
      }
      setTimeout(() => setFindStatus("idle"), 3500);
    }, 150);
  }, [findInput, points, allStargazers]);

  const handleSetUsername = useCallback((username: string) => {
    setStoredUsername(username);
    setStoredUsernameState(username);
  }, []);

  const findMe = useCallback(() => {
    const username = storedUsername;
    if (!username) return;
    setFindInput(username);
    findUser(username);
  }, [storedUsername, findUser]);

  const toggleSort = (key: SortKey) =>
    setAllSort((prev) => ({ key, dir: prev.key === key ? (-prev.dir as 1 | -1) : (key === "followers" || key === "starredAt") ? -1 : 1 }));

  const toggleRow = (login: string) =>
    setSelected((prev) => { const s = new Set(prev); s.has(login) ? s.delete(login) : s.add(login); return s; });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === filteredStargazers.length
        ? new Set()
        : new Set(filteredStargazers.map((u) => u.login))
    );

  const exportCsv = (rows: Record<string, unknown>[]) => {
    const cols = ["login", "name", "followers", "location", "starredAt", "mapped", "email", "company", "bio", "blog", "twitter_username", "following", "public_repos"] as const;
    const header = cols.join(",");
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) => cols.map((c) => escape(r[c as keyof typeof r])).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `stargazers-${owner}-${repo}.csv`; a.click();
  };

  const fetchAndExport = async () => {
    setFetching(true);
    try {
      const logins = [...selected];
      const base = allStargazers.filter((u) => logins.includes(u.login));
      if (logins.length === 0) { exportCsv(base); return; }
      const res = await fetch("/api/user-details", {
        method: "POST", headers: ghHeaders(),
        body: JSON.stringify({ logins }),
      });
      const data = await res.json();
      const detailMap = new Map((data.users as import("@/app/api/user-details/route").UserDetail[]).map((u) => [u.login, u]));
      const merged = base.map((u) => ({ ...u, ...detailMap.get(u.login) }));
      exportCsv(merged);
    } finally {
      setFetching(false);
    }
  };

  // Deferred points for stats — avoids blocking main thread on every chunk dispatch (INP: F3)
  const deferredPointsForStats = useDeferredValue(points);

  const stats = useMemo(() => {
    if (!deferredPointsForStats.length) return null;
    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    const companyCount = new Map<string, number>();
    for (const p of deferredPointsForStats) {
      if (p.location) {
        const parts = p.location.split(",").map((s) => s.trim()).filter(Boolean);
        const lastSegment = parts[parts.length - 1];
        const country = isCountry(lastSegment) ? normalizeCountry(lastSegment) : null;
        const city = parts.length > 1 ? parts[0] : null;
        if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + 1);
        if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
      }
      if (p.company) {
        const c = p.company.trim();
        if (c) companyCount.set(c, (companyCount.get(c) ?? 0) + 1);
      }
    }
    const topCountries = [...countryCount.entries()].sort((a, b) => b[1] - a[1]);
    const topCities = [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const topUsers = [...deferredPointsForStats]
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 30)
      .map((u) => ({ login: u.login, name: u.name, followers: u.followers, publicRepos: 0, location: u.location, avatarUrl: u.avatarUrl, company: u.company }));
    const topCompanies = [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const mappingRate = Math.round((deferredPointsForStats.length / (deferredPointsForStats.length + unmapped.length)) * 100);
    const avgFollowers = deferredPointsForStats.length > 0
      ? Math.round(deferredPointsForStats.reduce((s, p) => s + p.followers, 0) / deferredPointsForStats.length)
      : 0;
    const totalStars = deferredPointsForStats.length + unmapped.length;
    // botCount, enrichedUserCount, powerStargazers come from server stats only (requires dataVersion + cross-repo query)
    return { topCountries, topCities, topUsers, topCompanies, mappingRate, countryCount: countryCount.size, avgFollowers, totalStars, botCount: 0, enrichedUserCount: 0, powerStargazers: [] as RepoStats["powerStargazers"] };
  }, [deferredPointsForStats, unmapped]);

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const estimate = total > 0 ? estimateScan(total) : null;
  const newStarsCount = repoInfo && total > 0 ? Math.max(0, repoInfo.stars - total) : 0;
  // Client-side stats take priority; fall back to server stats when no points loaded yet
  const displayStats = stats ?? serverStats;

  // Stable callbacks for StargazerMap — prevents re-mount on every render (memo + shallow compare)
  const handleFlyDone = useCallback(() => setFlyTarget(null), []);
  const handleMapReady = useCallback(
    (controls: { captureCanvas: () => Promise<string | null>; setViewMode: (mode: "clusters" | "heatmap") => void; toggleProjection: () => MapProjection; getProjection: () => MapProjection }) => {
      mapControlsRef.current = controls;
      setMapProjection(controls.getProjection());
    },
    [setMapProjection],
  );

  return (
    <main id="main" className="relative w-screen h-screen overflow-hidden bg-background">

      {/* Global screen-reader live region for scan progress, errors, and status changes */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status === "loading" && total > 0 && `${processed.toLocaleString()} of ${total.toLocaleString()} stargazers loaded`}
        {status === "done" && `Scan complete: ${processed.toLocaleString()} stargazers loaded`}
        {status === "error" && error ? `Error: ${error}` : null}
      </div>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}

      {/* GitHub rate limit modal */}
      {repoRateLimited && (
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
                onClick={() => { setRepoRateLimited(false); setTokenOpen(true); }}
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
      )}

      {/* Repo not found modal */}
      {repoNotFound && (
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
      )}


      {/* Map */}
      <StargazerMapDynamic
        points={filteredMapPoints}
        comparePoints={comparePoints}
        flyTarget={flyTarget}
        onFlyDone={handleFlyDone}
        onReady={handleMapReady}
        styleUrl={mapStyleUrl}
        clusterRadius={debouncedClusterRadius}
      />

      {/* Attribution */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <a
            href="https://florian.bruniaux.com"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto text-2xs text-accent-orange/80 hover:text-accent-orange transition-colors bg-background/60 backdrop-blur-sm px-2 py-0.5 rounded-full border border-accent-orange/20"
          >
            by Florian Bruniaux
          </a>
          <a
            href="https://github.com/FlorianBruniaux"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto flex items-center gap-1 text-2xs text-muted/80 hover:text-foreground transition-colors bg-background/60 backdrop-blur-sm px-2 py-0.5 rounded-full border border-border/40 hover:border-accent-blue/40"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
            Follow
          </a>
        </div>
        <a
          href="https://www.jawg.io/?utm_source=starmapper&utm_medium=map-badge"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto text-2xs text-muted/70 hover:text-muted transition-colors"
        >
          Map by <strong className="font-semibold text-accent-blue/80 hover:text-accent-blue">Jawg Maps</strong>
        </a>
      </div>

      {/* Pre-scan overlay (no cache) */}
      {status === "idle" && cacheCheckDone && repoInfo && estimate && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prescan-title"
            className="bg-surface border border-border rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-6">
              {repoInfo.avatar && (
                <NextImage src={repoInfo.avatar} alt="" width={40} height={40} className="w-10 h-10 rounded-full" />
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
                  <button
                    type="button"
                    onClick={() => { pendingScanRef.current = true; setTokenOpen(true); }}
                    className="text-xs text-accent-blue hover:underline font-medium"
                  >
                    Add your GitHub token →
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={lastDbScan ? handleStartScan : (total >= TOKEN_REQUIRED_STARS ? handleStartScan : startScraping)}
              disabled={total >= TOKEN_REQUIRED_STARS && !hasToken}
              className={`w-full bg-accent-green-emphasis text-white font-medium py-3 rounded-lg transition-colors text-sm ${
                total >= TOKEN_REQUIRED_STARS && !hasToken
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:opacity-90"
              }`}
            >
              {lastDbScan ? `Rescan ${total.toLocaleString()} stars →` : `Start indexing ${total.toLocaleString()} stars →`}
            </button>
          </div>
        </div>
      )}

      {/* Rate limit overlay */}
      {status === "waiting" && (
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
      )}

      {/* Top panel */}
      <TopPanel
        owner={owner}
        repo={repo}
        repoInfo={repoInfo}
        compareOwner={compareOwner}
        compareRepo={compareRepo}
        compareInfo={compareInfo}
        compareStatus={compareStatus}
        comparePoints={comparePoints}
        points={points}
        total={total}
        unmapped={unmapped}
        setDrawerOpen={setDrawerOpen}
        status={status}
        pct={pct}
        retryIn={retryIn}
        processed={processed}
        estimate={estimate}
        cachedAt={cachedAt}
        latestStarredAt={latestStarredAt}
        startRefresh={handleStartRefresh}
        newStarsCount={newStarsCount}
        handleStartScan={handleStartScan}
        hasToken={hasToken}
        storedUsername={storedUsername}
        onSetUsername={handleSetUsername}
        findMe={findMe}
        error={error || null}
        findInput={findInput}
        setFindInput={setFindInput}
        setFindStatus={setFindStatus}
        findUser={findUser}
        findStatus={findStatus}
        organic={organicData ?? serverStats?.organic}
      />

      {/* Legend — compare mode indicator only */}
      {compareOwner && compareRepo && (
        <div className="absolute bottom-6 right-4 z-10
          bg-background/90 border border-border rounded-lg px-3 py-2
          text-xs backdrop-blur-md select-none flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-purple flex-shrink-0" />
          <span className="text-muted text-2xs truncate max-w-[120px]">{compareRepo}</span>
        </div>
      )}

      {/* Unmapped drawer */}
      {drawerOpen && (
        <div className="absolute bottom-0 left-0 right-0 z-20
          bg-background/95 border-t border-border backdrop-blur-md
          flex flex-col max-h-[45vh]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle flex-shrink-0">
            <div>
              <span className="text-sm text-muted">
                <strong className="text-foreground">{unmapped.length.toLocaleString()} stargazers</strong> without location
              </span>
              <span className="ml-2 text-2xs text-muted-subtle">— no location set on their GitHub profile</span>
            </div>
            <button onClick={() => setDrawerOpen(false)} aria-label="Close unmapped list" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
          </div>
          <div className="overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[...unmapped].sort((a, b) => b.followers - a.followers).map((u) => (
              <div
                key={u.login}
                className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-r border-surface text-xs ${
                  u.followers >= 1000 ? "ring-inset ring-1 ring-accent-orange/20" : ""
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-surface-alt flex-shrink-0 flex items-center justify-center text-2xs text-muted-subtle font-medium overflow-hidden">
                  {u.login[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={`/profile/${u.login}`}
                    className="text-accent-blue font-medium hover:underline block truncate"
                  >
                    @{u.login}
                  </a>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {u.name && (
                      <span className="text-muted-subtle truncate text-2xs">{u.name}</span>
                    )}
                    {u.followers >= 1000 && (
                      <span className="flex-shrink-0 text-2xs text-accent-orange font-medium"><span aria-hidden="true">⚡</span> {(u.followers / 1000).toFixed(1)}k</span>
                    )}
                    {u.followers > 0 && u.followers < 1000 && (
                      <span className="flex-shrink-0 text-2xs text-muted-subtle">{u.followers.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MapFloatingNav
        owner={owner}
        repo={repo}
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        projection={mapProjection}
        onProjectionToggle={() => {
          const next = mapControlsRef.current?.toggleProjection();
          if (next) setMapProjection(next);
        }}
      />

      {/* Bottom-left — vertical dock */}
      {(displayStats || allStargazers.length > 0) && (
        <Dock
          owner={owner}
          repo={repo}
          hasStats={!!displayStats}
          allStargazersCount={allStargazers.length}
          hasGrowthData={hasGrowthData}
          compareOwner={compareOwner}
          compareRepo={compareRepo}
          hasPoints={points.length > 0}
          viewMode={viewMode}
          setViewMode={setViewMode}
          followerMapFilter={followerMapFilter}
          setFollowerMapFilter={setFollowerMapFilter}
          clusterRadius={clusterRadius}
          setClusterRadius={setClusterRadius}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          setStatsOpen={setStatsOpen}
          setAllOpen={setAllOpen}
          setGrowthOpen={setGrowthOpen}
          setBadgeOpen={setBadgeOpen}
          setShareOpen={setShareOpen}
          hasTimelapse={weekBuckets.length > 1}
          timelapseActive={timelapseActive}
          setTimelapseActive={setTimelapseActive}
        />
      )}

      {/* Timelapse control bar */}
      {timelapseActive && weekBuckets.length > 1 && (
        <TimelapseBar
          weekBuckets={weekBuckets}
          currentIndex={timelapseIndex}
          autoPlay={timelapseAutoPlay}
          speed={timelapseSpeed}
          visibleCount={filteredMapPoints.length}
          onIndexChange={setTimelapseIndex}
          onSpeedChange={setTimelapseSpeed}
          onAutoPlayToggle={() => {
            if (timelapseIndex >= weekBuckets.length - 1) {
              setTimelapseIndex(0);
              setTimelapseAutoPlay(true);
            } else {
              setTimelapseAutoPlay((v) => !v);
            }
          }}
          onClose={() => {
            setTimelapseActive(false);
            setTimelapseAutoPlay(false);
          }}
        />
      )}

      {/* Stargazers table modal */}
      <Modal open={allOpen} onClose={() => setAllOpen(false)} maxWidth="max-w-5xl" innerClassName="flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle flex-shrink-0">
              <h2 className="text-foreground font-semibold text-sm">
                All Stargazers
                <span className="text-muted font-normal ml-2">
                  {filteredStargazers.length !== allStargazers.length
                    ? `${filteredStargazers.length} / ${allStargazers.length.toLocaleString()}`
                    : allStargazers.length.toLocaleString()}
                </span>
              </h2>
              <button onClick={() => setAllOpen(false)} aria-label="Close all stargazers" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-border-subtle flex-shrink-0">
              <input
                autoFocus
                value={allSearch}
                onChange={(e) => setAllSearch(e.target.value)}
                placeholder="Search by username, name or location…"
                aria-label="Search stargazers"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue"
              />
            </div>

            {/* Filters */}
            <div className="px-5 py-2.5 border-b border-border-subtle flex-shrink-0 flex flex-wrap items-center gap-3">
              {/* Followers filter */}
              <div className="flex items-center gap-2 min-w-0">
                <span id="filter-followers-label" className="text-2xs text-muted whitespace-nowrap">Min followers</span>
                <div role="radiogroup" aria-labelledby="filter-followers-label" className="flex gap-1">
                  {[0, 10, 100, 500, 1000].map((v) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={filterFollowers === v}
                      onClick={() => setFilterFollowers(v)}
                      className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                        filterFollowers === v
                          ? "bg-accent-blue text-white"
                          : "bg-surface-alt text-muted hover:text-foreground"
                      }`}
                    >
                      {v === 0 ? "All" : v >= 1000 ? `${v / 1000}k+` : `${v}+`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-3 w-px bg-border hidden sm:block" />

              {/* Mapped filter */}
              <div className="flex items-center gap-2">
                <span id="filter-location-label" className="text-2xs text-muted whitespace-nowrap">Location</span>
                <div role="radiogroup" aria-labelledby="filter-location-label" className="flex gap-1">
                  {(["all", "mapped", "unmapped"] as const).map((v) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={filterMapped === v}
                      onClick={() => setFilterMapped(v)}
                      className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                        filterMapped === v
                          ? "bg-accent-blue text-white"
                          : "bg-surface-alt text-muted hover:text-foreground"
                      }`}
                    >
                      {v === "all" ? "All" : v === "mapped" ? <><span aria-hidden="true">📍</span> On map</> : "No location"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-3 w-px bg-border hidden sm:block" />

              {/* Date filter */}
              <div className="flex items-center gap-2">
                <span id="filter-starred-label" className="text-2xs text-muted whitespace-nowrap">Starred</span>
                <div role="radiogroup" aria-labelledby="filter-starred-label" className="flex gap-1">
                  {(["all", "30d", "90d", "1y"] as const).map((v) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={filterDate === v}
                      onClick={() => setFilterDate(v)}
                      className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                        filterDate === v ? "bg-accent-blue text-white" : "bg-surface-alt text-muted hover:text-foreground"
                      }`}
                    >
                      {v === "all" ? "All time" : v === "30d" ? "30d" : v === "90d" ? "90d" : "1y"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Company filter */}
              <input
                value={filterCompany}
                onChange={(e) => startTransition(() => setFilterCompany(e.target.value))}
                placeholder="Company…"
                aria-label="Filter by company"
                className="bg-background border border-border rounded px-2 py-0.5 text-2xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue w-24"
              />

              {/* Country filter */}
              <FilterCombobox
                value={filterCountry}
                onChange={(v) => startTransition(() => setFilterCountry(v))}
                options={countryOptions}
                placeholder="Country…"
              />

              {/* City filter */}
              <FilterCombobox
                value={filterCity}
                onChange={(v) => startTransition(() => setFilterCity(v))}
                options={cityOptions}
                placeholder="City…"
              />

              {/* Active filters count + reset */}
              {(filterFollowers > 0 || filterMapped !== "all" || filterDate !== "all" || filterCompany || filterCountry || filterCity) && (
                <button
                  onClick={() => { setFilterFollowers(0); setFilterMapped("all"); setFilterDate("all"); setFilterCompany(""); setFilterCountry(""); setFilterCity(""); }}
                  className="ml-auto text-2xs text-muted-subtle hover:text-muted transition-colors"
                >
                  ✕ Reset filters
                </button>
              )}
            </div>

            {/* Table */}
            <div
              ref={tableContainerRef}
              className="overflow-y-auto flex-1 relative"
              onScroll={(e) => setTableScrollTop((e.currentTarget).scrollTop)}
            >
              {isSearchPending && (
                <div className="sticky top-0 left-0 right-0 z-20 flex items-center justify-center py-1 bg-surface/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-2xs text-muted-subtle">
                    <svg className="animate-spin motion-reduce:animate-none w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Filtering…
                  </div>
                </div>
              )}
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-border-subtle">
                    {csvEnabled && (
                      <th className="px-3 py-2.5 w-8">
                        <input
                          type="checkbox"
                          checked={selected.size > 0 && selected.size === filteredStargazers.length}
                          ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filteredStargazers.length; }}
                          onChange={toggleAll}
                          className="accent-accent-blue cursor-pointer"
                        />
                      </th>
                    )}
                    <th scope="col" className="px-3 py-2.5 text-left text-muted font-medium w-6 text-right">#</th>
                    <th scope="col" aria-sort={allSort.key === "login" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium">
                      <button onClick={() => toggleSort("login")} className="flex items-center gap-1 hover:text-foreground">
                        User <span aria-hidden="true">{allSort.key === "login" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                      </button>
                    </th>
                    <th scope="col" aria-sort={allSort.key === "followers" ? (allSort.dir === -1 ? "descending" : "ascending") : "none"} className="px-3 py-2.5 text-right text-muted font-medium">
                      <button onClick={() => toggleSort("followers")} className="flex items-center gap-1 hover:text-foreground ml-auto">
                        <span aria-hidden="true">{allSort.key === "followers" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span> Followers
                      </button>
                    </th>
                    <th scope="col" aria-sort={allSort.key === "location" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden sm:table-cell">
                      <button onClick={() => toggleSort("location")} className="flex items-center gap-1 hover:text-foreground">
                        Location <span aria-hidden="true">{allSort.key === "location" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                      </button>
                    </th>
                    <th scope="col" aria-sort={allSort.key === "starredAt" ? (allSort.dir === -1 ? "descending" : "ascending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden md:table-cell">
                      <button onClick={() => toggleSort("starredAt")} className="flex items-center gap-1 hover:text-foreground">
                        Starred <span aria-hidden="true">{allSort.key === "starredAt" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                      </button>
                    </th>
                    <th scope="col" aria-sort={allSort.key === "company" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden lg:table-cell">
                      <button onClick={() => toggleSort("company")} className="flex items-center gap-1 hover:text-foreground">
                        Company <span aria-hidden="true">{allSort.key === "company" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                      </button>
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-left text-muted font-medium hidden xl:table-cell">Links</th>
                    <th scope="col" className="px-3 py-2.5 w-8"></th>
                    <th scope="col" className="px-4 py-2.5 text-center text-muted font-medium">Map</th>
                  </tr>
                </thead>
                <tbody>
                  {tablePadTop > 0 && <tr style={{ height: tablePadTop }}><td colSpan={10} style={{ padding: 0 }} /></tr>}
                  {tableSlice.map((u, _i) => {
                    const i = tableVStart + _i;
                    return (
                    <tr
                      key={u.login}
                      onClick={csvEnabled ? () => toggleRow(u.login) : undefined}
                      className={`border-b border-surface transition-colors ${
                        csvEnabled
                          ? selected.has(u.login) ? "bg-surface-alt cursor-pointer" : "hover:bg-background cursor-pointer"
                          : ""
                      }`}
                    >
                      {csvEnabled && (
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(u.login)}
                            onChange={() => toggleRow(u.login)}
                            className="accent-accent-blue cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-muted-subtle text-right">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {u.avatarUrl
                            ? <NextImage src={u.avatarUrl} alt="" width={24} height={24} className="w-6 h-6 rounded-full flex-shrink-0" />
                            : <div className="w-6 h-6 rounded-full bg-surface-alt flex-shrink-0" />
                          }
                          <div className="min-w-0">
                            <a
                              href={`/profile/${u.login}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-accent-blue font-medium hover:underline"
                            >
                              @{u.login}
                            </a>
                            {u.name && u.name !== u.login && (
                              <div className="text-muted text-2xs truncate max-w-[140px]">{u.name}</div>
                            )}
                            {u.bio && (
                              <div className="text-muted-subtle text-2xs truncate max-w-[140px]" title={u.bio}>{u.bio}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">
                        {u.followers > 0 ? u.followers.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted max-w-[160px] hidden sm:table-cell">
                        <span className="truncate block">{u.location ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-subtle hidden md:table-cell tabular-nums">
                        {u.starredAt ? new Date(u.starredAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-subtle hidden lg:table-cell">
                        <span className="truncate block max-w-[120px]">{u.company ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          {u.email && (
                            <a href={`mailto:${u.email}`} title={u.email} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-8.5A1.75 1.75 0 0 0 14.25 2Zm0 1.5h12.5a.25.25 0 0 1 .25.25v.852l-6.36 3.682a.25.25 0 0 1-.254 0L1.5 4.602V3.75a.25.25 0 0 1 .25-.25Zm-.25 2.68 5.86 3.393a1.75 1.75 0 0 0 1.78 0L15 6.18v6.07a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25Z"/></svg>
                            </a>
                          )}
                          {u.blog && (
                            <a href={u.blog.startsWith("http") ? u.blog : `https://${u.blog}`} title={u.blog} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/></svg>
                            </a>
                          )}
                          {u.twitter_username && (
                            <a href={`https://x.com/${u.twitter_username}`} title={`@${u.twitter_username}`} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                            </a>
                          )}
                          {!u.email && !u.blog && !u.twitter_username && (
                            <span className="text-border text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${u.mapped ? "bg-accent-green" : "bg-border"}`} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        {u.mapped && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const pt = points.find((p) => p.login === u.login);
                              if (pt) { setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login }); setAllOpen(false); }
                            }}
                            aria-label={`Fly to ${u.login} on map`}
                            className="text-muted-subtle hover:text-accent-blue transition-colors text-xs"
                          >
                            <span aria-hidden="true">🗺</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                  })}
                  {tablePadBottom > 0 && <tr style={{ height: tablePadBottom }}><td colSpan={10} style={{ padding: 0 }} /></tr>}
                </tbody>
              </table>
              {filteredStargazers.length === 0 && !isSearchPending && (
                <div className="text-center text-muted-subtle text-xs py-12">No results for &ldquo;{allSearch}&rdquo;</div>
              )}
            </div>

            {/* Selection action bar — only when CSV export is enabled */}
            {csvEnabled && selected.size > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle bg-background rounded-b-2xl flex-shrink-0">
                <span className="text-xs text-muted">
                  <strong className="text-foreground">{selected.size}</strong> selected
                  <button onClick={() => setSelected(new Set())} className="ml-3 text-muted-subtle hover:text-muted">✕ Clear</button>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText([...selected].join("\n"))}
                    className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Copy logins
                  </button>
                  <button
                    onClick={() => exportCsv(allStargazers.filter((u) => selected.has(u.login)))}
                    className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    ↓ Export CSV
                  </button>
                  <button
                    onClick={fetchAndExport}
                    disabled={fetching}
                    className="bg-accent-green-emphasis hover:opacity-90 disabled:opacity-50 rounded-lg px-3 py-1.5 text-xs text-white font-medium transition-opacity"
                  >
                    {fetching ? "Fetching…" : `↓ Fetch details + CSV (${selected.size})`}
                  </button>
                </div>
              </div>
            )}
      </Modal>

      {/* Growth chart modal */}
      <Modal open={growthOpen && growthData.length > 0} onClose={() => setGrowthOpen(false)} maxWidth="max-w-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
              <div>
                <h2 className="text-foreground font-semibold text-sm">Star Growth</h2>
                <p className="text-muted text-2xs mt-0.5">{growthData.length} weeks · {(points.length + unmapped.length).toLocaleString()} total stars</p>
              </div>
              <button onClick={() => setGrowthOpen(false)} aria-label="Close star growth" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
            </div>
            <div className="px-5 py-5">
              <GrowthChart data={growthData} />
            </div>
      </Modal>

      {/* Share modal */}
      {repoInfo && (
      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share" maxWidth="max-w-lg">


            {/* Preview card */}
            <div id="share-card" className="mx-5 my-4 bg-background rounded-xl p-6 border border-border">
              <div className="flex items-center gap-3 mb-4">
                {repoInfo.avatar && <NextImage src={repoInfo.avatar} alt="" width={40} height={40} className="w-10 h-10 rounded-full border border-border flex-shrink-0" />}
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
              {displayStats && displayStats.topCountries.slice(0, 3).length > 0 && (
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
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url).catch(() => {});
                }}
                className="flex-1 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-sm py-2 rounded-lg transition-colors"
              >
                Copy link
              </button>
              <button
                onClick={async () => {
                  const dataUrl = await mapControlsRef.current?.captureCanvas();
                  if (!dataUrl) return;
                  const mapImg = new Image();
                  await new Promise<void>((res) => { mapImg.onload = () => res(); mapImg.src = dataUrl; });
                  const W = mapImg.naturalWidth, H = mapImg.naturalHeight;
                  const S = W / 1440; // scale factor relative to 1440px reference

                  const out = document.createElement("canvas");
                  out.width = W; out.height = H;
                  const ctx = out.getContext("2d")!;

                  // 1. Map background
                  ctx.drawImage(mapImg, 0, 0);

                  // 2. Stats panel (top-center)
                  const panelW = Math.round(360 * S);
                  const panelX = Math.round((W - panelW) / 2);
                  const panelY = Math.round(20 * S);
                  const pad = Math.round(20 * S);
                  const avatarSize = Math.round(32 * S);

                  // Avatar height + name + stats + tags + footer
                  const boxH = Math.round(66 * S);
                  const tagsH = displayStats?.topCountries.length ? Math.round(34 * S) : 0;
                  const footerH = Math.round(28 * S);
                  const panelH = pad + avatarSize + Math.round(12 * S) + boxH + tagsH + footerH + pad;

                  ctx.fillStyle = "rgba(13,17,23,0.92)";
                  ctx.beginPath();
                  ctx.roundRect(panelX, panelY, panelW, panelH, Math.round(12 * S));
                  ctx.fill();
                  ctx.strokeStyle = "#30363d";
                  ctx.lineWidth = 1;
                  ctx.stroke();

                  // Avatar
                  if (repoInfo!.avatar) {
                    try {
                      const img = new Image(); img.crossOrigin = "anonymous";
                      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = repoInfo!.avatar!; });
                      ctx.save();
                      ctx.beginPath();
                      ctx.arc(panelX + pad + avatarSize / 2, panelY + pad + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                      ctx.clip();
                      ctx.drawImage(img, panelX + pad, panelY + pad, avatarSize, avatarSize);
                      ctx.restore();
                    } catch { /* skip avatar on CORS error */ }
                  }

                  // Repo name
                  const nameSize = Math.round(13 * S);
                  ctx.fillStyle = "#f0f6fc";
                  ctx.font = `bold ${nameSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
                  ctx.textAlign = "left";
                  ctx.fillText(`${owner}/${repo}`, panelX + pad + avatarSize + Math.round(10 * S), panelY + pad + Math.round(nameSize * 0.85));

                  // 3 stat boxes
                  const statsY = panelY + pad + avatarSize + Math.round(12 * S);
                  const gap = Math.round(6 * S);
                  const bW = Math.round((panelW - pad * 2 - gap * 2) / 3);
                  const statsArr = [
                    { v: repoInfo!.stars ?? total, label: "★ STARS", color: "#ffa657" },
                    { v: points.length, label: "MAPPED", color: "#58a6ff" },
                    { v: displayStats?.countryCount ?? 0, label: "COUNTRIES", color: "#3fb950" },
                  ];
                  for (let i = 0; i < 3; i++) {
                    const bx = panelX + pad + i * (bW + gap);
                    ctx.fillStyle = "rgba(22,27,34,0.9)";
                    ctx.beginPath();
                    ctx.roundRect(bx, statsY, bW, boxH, Math.round(8 * S));
                    ctx.fill();
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

                  // Top countries tags
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
                      ctx.beginPath();
                      ctx.roundRect(tagX, tagsY, tw, tH, Math.round(5 * S));
                      ctx.fill();
                      ctx.strokeStyle = "#30363d"; ctx.lineWidth = 1; ctx.stroke();
                      ctx.fillStyle = "#8b949e";
                      ctx.textAlign = "left";
                      ctx.fillText(text, tagX + Math.round(7 * S), tagsY + Math.round(14 * S));
                      tagX += tw + Math.round(6 * S);
                    }
                  }

                  // Footer branding
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
                }}
                className="flex-1 bg-accent-green-emphasis hover:opacity-90 text-white text-sm py-2 rounded-lg transition-opacity font-medium"
              >
                ↓ Download PNG
              </button>
              </div>
              {/* Social share */}
              <div className="flex gap-2">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🌍 ${repo} just hit ${repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars} ⭐ — with stargazers from ${stats?.countryCount ?? "?"} countries!`)}&url=${encodeURIComponent(window.location.href)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 bg-surface-alt hover:bg-border border border-border text-muted hover:text-foreground text-xs py-2 rounded-lg transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                  Share on X
                </a>
                <button
                  onClick={() => {
                    const starsLabel = repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars;
                    setLiDraft(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${displayStats?.countryCount ?? "?"} countries!\n\n${window.location.href}`);
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
                      onChange={(e) => setLiDraft(e.target.value)}
                      rows={5}
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
            </div>
      </Modal>
      )}

      {/* Badge modal */}
      <Modal open={badgeOpen} onClose={() => setBadgeOpen(false)} title="README Badge">
            <div className="px-5 py-4 space-y-4">
              {/* Map image preview */}
              <div className="rounded-lg border border-border-subtle overflow-hidden bg-[#010409]">
                <img
                  src={`/api/map-image/${owner}/${repo}?theme=dark`}
                  alt="StarMapper map preview"
                  className="w-full"
                />
              </div>
              {/* Tabs */}
              <div role="tablist" aria-label="Badge type" className="flex gap-1 bg-surface-alt rounded-lg p-1">
                <button
                  role="tab"
                  id="badge-tab-map"
                  aria-selected={badgeTab === "map"}
                  aria-controls="badge-panel-map"
                  tabIndex={badgeTab === "map" ? 0 : -1}
                  onClick={() => setBadgeTab("map")}
                  onKeyDown={(e) => { if (e.key === "ArrowRight") { setBadgeTab("shield"); } }}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${badgeTab === "map" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  Map image
                </button>
                <button
                  role="tab"
                  id="badge-tab-shield"
                  aria-selected={badgeTab === "shield"}
                  aria-controls="badge-panel-shield"
                  tabIndex={badgeTab === "shield" ? 0 : -1}
                  onClick={() => setBadgeTab("shield")}
                  onKeyDown={(e) => { if (e.key === "ArrowLeft") { setBadgeTab("map"); } }}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${badgeTab === "shield" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  Shield badge
                </button>
              </div>
              <div
                role="tabpanel"
                id="badge-panel-map"
                aria-labelledby="badge-tab-map"
                hidden={badgeTab !== "map"}
              >
                {badgeTab === "map" && (
                  <div>
                    <p className="text-muted text-xs leading-relaxed mb-2">
                      Embeds the map image in your README — switches between dark and light theme automatically.
                    </p>
                    <div className="bg-background border border-border rounded-lg px-3 py-2.5">
                      <code className="text-muted text-xs break-all select-all leading-relaxed whitespace-pre-wrap">
                        {typeof window !== "undefined"
                          ? `## StarMapper\n\n<a href="${window.location.origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${window.location.origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${window.location.origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                          : ""}
                      </code>
                    </div>
                  </div>
                )}
              </div>
              <div
                role="tabpanel"
                id="badge-panel-shield"
                aria-labelledby="badge-tab-shield"
                hidden={badgeTab !== "shield"}
              >
                {badgeTab === "shield" && (
                  <div>
                    <p className="text-muted text-xs leading-relaxed mb-2">
                      Classic shield badge for Markdown READMEs.
                    </p>
                    <div className="flex justify-center py-2">
                      <img
                        src={`/api/badge/${owner}/${repo}`}
                        alt="StarMapper badge"
                        className="h-5"
                      />
                    </div>
                    <div className="bg-background border border-border rounded-lg px-3 py-2.5 mt-2">
                      <code className="text-muted text-xs break-all select-all leading-relaxed">
                        {typeof window !== "undefined"
                          ? `[![StarMapper](${window.location.origin}/api/badge/${owner}/${repo})](${window.location.origin}/${owner}/${repo})`
                          : ""}
                      </code>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pb-4">
              <button
                onClick={() => {
                  const origin = window.location.origin;
                  const text = badgeTab === "map"
                    ? `## StarMapper\n\n<a href="${origin}/${owner}/${repo}">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=dark" />\n    <source media="(prefers-color-scheme: light)" srcset="${origin}/api/map-image/${owner}/${repo}?theme=light" />\n    <img alt="StarMapper" src="${origin}/api/map-image/${owner}/${repo}" />\n  </picture>\n</a>`
                    : `[![StarMapper](${origin}/api/badge/${owner}/${repo})](${origin}/${owner}/${repo})`;
                  navigator.clipboard.writeText(text).catch(() => {});
                  setBadgeCopied(true);
                  setTimeout(() => setBadgeCopied(false), 2000);
                }}
                className="w-full flex items-center justify-center gap-2 bg-accent-green-emphasis hover:opacity-90 text-white text-xs font-medium py-2.5 rounded-lg transition-opacity"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {badgeCopied ? "Copied ✓" : badgeTab === "map" ? "Copy HTML" : "Copy Markdown"}
              </button>
            </div>
      </Modal>

      {/* Stats modal */}
      {displayStats && (
      <Modal open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="max-w-lg" innerClassName="flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle flex-shrink-0">
              <h2 className="text-foreground font-semibold text-sm">Stargazer Stats</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const md = [
                      `# StarMapper — ${owner}/${repo}`,
                      ``,
                      `- **Total stargazers**: ${displayStats.totalStars.toLocaleString()} (${displayStats.mappingRate}% mapped)`,
                      `- **Countries**: ${displayStats.countryCount}`,
                      `- **Cities**: ${displayStats.topCities.length}`,
                      `- **Avg followers**: ${displayStats.avgFollowers.toLocaleString()}`,
                      ``,
                      `## Top Countries`,
                      ...displayStats.topCountries.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`),
                      ``,
                      `## Top Cities`,
                      ...displayStats.topCities.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`),
                      `## Top Companies`,
                      ...(displayStats.topCompanies.length ? displayStats.topCompanies.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`) : ["No company data"]),
                      ``,
                      `## Top Stargazers`,
                      ...displayStats.topUsers.slice(0, 10).map((u, i) => `${i + 1}. [@${u.login}](https://github.com/${u.login}) — ${u.followers.toLocaleString()} followers`),
                      ``,
                      `*Generated by [StarMapper](${process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com"})*`,
                    ].join("\n");
                    navigator.clipboard.writeText(md).catch(() => {});
                  }}
                  className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground bg-surface-alt hover:bg-border border border-border rounded-lg px-2.5 py-1 transition-colors"
                  title="Copy stats as Markdown"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
                  </svg>
                  Copy MD
                </button>
                <button onClick={() => setStatsOpen(false)} aria-label="Close stats" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-6 gap-2 px-5 py-4 border-b border-border-subtle flex-shrink-0">
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-foreground">
                  {displayStats.totalStars >= 1000 ? `${(displayStats.totalStars / 1000).toFixed(1)}k` : displayStats.totalStars}
                </div>
                <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">stars</div>
              </div>
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-accent-green">{displayStats.mappingRate}%</div>
                <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">mapped</div>
              </div>
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-foreground">{displayStats.countryCount}</div>
                <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">countries</div>
              </div>
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-foreground">{displayStats.topCities.length}</div>
                <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">cities</div>
              </div>
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-accent-orange">
                  {displayStats.avgFollowers >= 1000 ? `${(displayStats.avgFollowers / 1000).toFixed(1)}k` : displayStats.avgFollowers}
                </div>
                <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">avg flw</div>
              </div>
              <div className="bg-background rounded-lg px-2 py-2 text-center">
                {(() => {
                  const { botCount, enrichedUserCount } = displayStats;
                  const pct = enrichedUserCount > 0 ? Math.round((botCount / enrichedUserCount) * 100) : null;
                  return (
                    <>
                      <div className={`text-xl font-bold ${pct !== null && pct > 20 ? "text-accent-red" : "text-muted"}`}>
                        {pct !== null ? `${pct}%` : "—"}
                      </div>
                      <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">suspect</div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Stats view" className="flex border-b border-border-subtle flex-shrink-0">
              {(["top", "countries", "cities", "companies", "power"] as const).map((tab, idx, arr) => (
                <button
                  key={tab}
                  role="tab"
                  id={`stats-tab-${tab}`}
                  aria-selected={statsTab === tab}
                  aria-controls={`stats-panel-${tab}`}
                  tabIndex={statsTab === tab ? 0 : -1}
                  onClick={() => { setStatsTab(tab); setStatsFilter(""); }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") { const next = arr[(idx + 1) % arr.length]; setStatsTab(next); setStatsFilter(""); }
                    if (e.key === "ArrowLeft") { const prev = arr[(idx - 1 + arr.length) % arr.length]; setStatsTab(prev); setStatsFilter(""); }
                  }}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    statsTab === tab
                      ? "text-accent-blue border-b-2 border-accent-blue -mb-px"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab === "top" ? "Top Stars" : tab === "countries" ? "Countries" : tab === "cities" ? "Cities" : tab === "companies" ? "Companies" : <><span aria-hidden="true">⚡</span> Power</>}
                </button>
              ))}
            </div>

            {/* Filter input for countries/cities/companies */}
            {(statsTab === "countries" || statsTab === "cities" || statsTab === "companies") && (
              <div className="px-5 pt-3 flex-shrink-0">
                <input
                  value={statsFilter}
                  onChange={(e) => setStatsFilter(e.target.value)}
                  placeholder={`Filter ${statsTab}…`}
                  aria-label={`Filter ${statsTab}`}
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue"
                />
              </div>
            )}

            {/* List — tabpanel */}
            <div
              role="tabpanel"
              id={`stats-panel-${statsTab}`}
              aria-labelledby={`stats-tab-${statsTab}`}
              className="overflow-y-auto flex-1 px-5 py-3"
            >
              {statsTab === "top" && (
                <div>
                  {/* Sort toggle */}
                  <div className="flex items-center gap-1 mb-3">
                    <span id="stats-sort-label" className="text-muted-subtle text-2xs uppercase tracking-wide mr-1">Sort:</span>
                    <div role="radiogroup" aria-labelledby="stats-sort-label" className="flex gap-1">
                      {(["followers", "repos"] as const).map((s) => (
                        <button
                          key={s}
                          role="radio"
                          aria-checked={statsTopSort === s}
                          onClick={() => setStatsTopSort(s)}
                          className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${
                            statsTopSort === s
                              ? "bg-accent-blue/20 text-accent-blue"
                              : "text-muted hover:text-foreground"
                          }`}
                        >
                          {s === "followers" ? "Followers" : "Public repos"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {[...displayStats.topUsers]
                      .sort((a, b) => statsTopSort === "followers" ? b.followers - a.followers : b.publicRepos - a.publicRepos)
                      .map((u, i) => (
                      <div key={u.login} className="flex items-center gap-3 py-0.5">
                        <span className="text-muted-subtle text-xs w-5 text-right flex-shrink-0">{i + 1}</span>
                        {u.avatarUrl
                          ? <NextImage src={u.avatarUrl} alt="" width={32} height={32} className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border" />
                          : <div className="w-8 h-8 rounded-full bg-surface-alt flex-shrink-0 ring-1 ring-border" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <a
                              href={`/profile/${u.login}`}
                              className="text-accent-blue text-xs font-medium hover:underline"
                            >
                              @{u.login}
                            </a>
                            {u.company && (
                              <span className="text-2xs text-muted bg-surface-alt border border-border-subtle rounded px-1.5 py-px truncate max-w-24">
                                {u.company.replace(/^@/, "")}
                              </span>
                            )}
                          </div>
                          {u.name && u.name !== u.login && (
                            <div className="text-muted-subtle text-2xs truncate">{u.name}</div>
                          )}
                          {!u.name && u.location && (
                            <div className="text-muted-subtle text-2xs truncate">{u.location}</div>
                          )}
                        </div>
                        {statsTopSort === "repos" && u.publicRepos > 0 ? (
                          <a
                            href={`https://github.com/${u.login}?tab=repositories`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-blue text-xs flex-shrink-0 tabular-nums hover:underline"
                            title="View public repos"
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="inline mr-1 mb-0.5"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/></svg>
                            {u.publicRepos.toLocaleString()}
                          </a>
                        ) : (
                          <span className="text-muted text-xs flex-shrink-0 tabular-nums">
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="inline mr-1 mb-0.5 text-muted"><path d="M3 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM1.5 3A1.5 1.5 0 0 0 0 4.5v7A1.5 1.5 0 0 0 1.5 13h13a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 14.5 3Z"/></svg>
                            {u.followers.toLocaleString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {statsTab === "countries" && (
                <StatsList
                  items={displayStats.topCountries.filter(([name]) => !statsFilter || name.toLowerCase().includes(statsFilter.toLowerCase()))}
                  max={displayStats.topCountries[0]?.[1] ?? 1}
                />
              )}
              {statsTab === "cities" && (
                <StatsList
                  items={displayStats.topCities.filter(([name]) => !statsFilter || name.toLowerCase().includes(statsFilter.toLowerCase()))}
                  max={displayStats.topCities[0]?.[1] ?? 1}
                />
              )}
              {statsTab === "companies" && (
                <div className="space-y-2">
                  {displayStats.topCompanies
                    .filter(([company]) => !statsFilter || company.toLowerCase().includes(statsFilter.toLowerCase()))
                    .map(([company, count], idx) => (
                    <div key={company} className="flex items-center gap-3">
                      <div className="text-muted-subtle text-xs w-4 text-right flex-shrink-0">{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-foreground text-xs truncate">{company}</span>
                          <span className="text-muted text-xs ml-2 flex-shrink-0">{count}</span>
                        </div>
                        <div className="h-1 bg-surface-alt rounded-full">
                          <div className="h-1 bg-accent-blue rounded-full" style={{ width: `${(count / (displayStats.topCompanies[0]?.[1] ?? 1)) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {displayStats.topCompanies.length === 0 && (
                    <div className="text-center text-muted-subtle text-xs py-8">No company data available</div>
                  )}
                </div>
              )}
              {statsTab === "power" && (
                <div className="space-y-2.5">
                  {displayStats.powerStargazers.length === 0 && (
                    <div className="text-center text-muted-subtle text-xs py-8">
                      <div className="text-2xl mb-2" aria-hidden="true">⚡</div>
                      <div>No power stargazers yet.</div>
                      <div className="mt-1 text-2xs">Appears after multiple repos are scanned.</div>
                    </div>
                  )}
                  {displayStats.powerStargazers.map((u, i) => (
                    <div key={u.login} className="flex items-center gap-3 py-0.5">
                      <span className="text-muted-subtle text-xs w-5 text-right flex-shrink-0">{i + 1}</span>
                      <NextImage src={u.avatarUrl} alt="" width={32} height={32} className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border" />
                      <div className="flex-1 min-w-0">
                        <a
                          href={`/profile/${u.login}`}
                          className="text-accent-blue text-xs font-medium hover:underline"
                        >
                          @{u.login}
                        </a>
                        {u.name && u.name !== u.login && (
                          <div className="text-muted-subtle text-2xs truncate">{u.name}</div>
                        )}
                      </div>
                      <span className="text-accent-orange text-xs flex-shrink-0 tabular-nums font-medium">
                        {u.trackedRepos} repos
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
      </Modal>
      )}
    </main>
  );
}


const GrowthChart = ({ data }: { data: [string, number][] }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(...data.map(([, v]) => v));
  const H = 120;
  const W = 600;
  const barW = Math.max(2, Math.floor((W - data.length) / data.length));
  const gap = Math.max(1, Math.floor(W / data.length) - barW);
  const labelStep = Math.ceil(data.length / 10);
  const total = data.reduce((s, [, v]) => s + v, 0);
  const avg = Math.round(total / data.length);
  const avgY = H - (avg / max) * H;
  const peak = data.reduce((best, cur) => cur[1] > best[1] ? cur : best, data[0]);

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;
  const hoveredX = hoveredIdx !== null ? hoveredIdx * (barW + gap) : 0;
  const tooltipW = 100;
  const tooltipX = Math.min(hoveredX, W - tooltipW - 4);
  const tooltipY = hoveredItem ? H - (hoveredItem[1] / max) * H - 40 : 0;

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-foreground">{total.toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">total stars</div>
        </div>
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-accent-blue">{peak[1].toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">best week</div>
        </div>
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-accent-orange">{avg.toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">avg / week</div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="w-full"
        style={{ height: H + 20 }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* Average line */}
        <line
          x1={0} y1={avgY} x2={W} y2={avgY}
          stroke="var(--color-accent-orange)" strokeWidth={1} strokeDasharray="5,4" opacity={0.5}
        />
        <text x={W - 2} y={avgY - 3} fontSize={7} fill="var(--color-accent-orange)" textAnchor="end" opacity={0.7}>avg</text>

        {data.map(([date, count], i) => {
          const barH = Math.max(2, (count / max) * H);
          const x = i * (barW + gap);
          const isPeak = date === peak[0];
          const isHovered = i === hoveredIdx;
          return (
            <g key={date}>
              <rect
                x={x} y={H - barH} width={barW} height={barH}
                fill={isPeak ? "var(--color-accent-orange)" : "var(--color-accent-blue)"}
                opacity={isHovered ? 1 : isPeak ? 0.9 : 0.65}
                rx={1}
              />
              {/* Invisible wider hit area for hover */}
              <rect
                x={x - Math.max(1, gap / 2)} y={0} width={barW + Math.max(1, gap)} height={H}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
              />
              {i % labelStep === 0 && (
                <text x={x} y={H + 14} fontSize={8} fill="var(--color-muted-subtle)" textAnchor="middle" dx={barW / 2}>
                  {date.slice(5)}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hoveredItem && (
          <g>
            <rect
              x={tooltipX} y={Math.max(2, tooltipY)} width={tooltipW} height={30}
              rx={4} fill="var(--color-surface-alt)" stroke="var(--color-border)" strokeWidth={1}
            />
            <text x={tooltipX + 8} y={Math.max(14, tooltipY + 12)} fontSize={8} fill="var(--color-muted)">
              {hoveredItem[0].slice(5)}
            </text>
            <text x={tooltipX + 8} y={Math.max(26, tooltipY + 24)} fontSize={9} fill="var(--color-foreground)" fontWeight="bold">
              {hoveredItem[1].toLocaleString()} stars
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
