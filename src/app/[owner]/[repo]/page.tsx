// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useEffect, useRef, useState, useCallback, useMemo, useDeferredValue, useReducer } from "react";
import { useScanController, scanReducer } from "@/hooks/useScanController";
import { StatsModal } from "@/components/map/stats-modal";
import { BadgeModal } from "@/components/map/badge-modal";
import { GrowthModal } from "@/components/map/growth-modal";
import { AllStargazersModal } from "@/components/map/all-stargazers-modal";
import type { AnyStargazer } from "@/components/map/all-stargazers-modal";
import NextImage from "next/image";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { MapFloatingNav } from "@/components/map/map-floating-nav";
import { CLUSTER_RADIUS } from "@/components/map/constants";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";
import type { MapProjection } from "@/lib/theme";
import type { RepoStats, RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import { TokenModal, getStoredToken, getStoredUsername, setStoredUsername } from "@/components/token-modal";
import { Modal } from "@/components/modal";
import { isCountry, normalizeCountry } from "@/lib/countries";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { TopPanel } from "@/components/map/top-panel";
import { Dock } from "@/components/map/dock";
import { TimelapseBar } from "@/components/map/timelapse-bar";
import { formatEstimate, timeAgo } from "@/lib/format";
import type { TimeEstimate } from "@/lib/format";
import { useWatchMode } from "@/hooks/useWatchMode";
import { useTimelapse } from "@/hooks/useTimelapse";
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
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

  const [total, setTotal] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [findInput, setFindInput] = useState("");
  const [findStatus, setFindStatus] = useState<"idle" | "searching" | "found" | "no-location" | "not-found">("idle");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [latestStarredAt, setLatestStarredAt] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<RepoStats | null>(null);
  const [organicData, setOrganicData] = useState<RepoOrganic | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [liPanelOpen, setLiPanelOpen] = useState(false);
  const [liDraft, setLiDraft] = useState("");
  const [liCopied, setLiCopied] = useState(false);
  const [badgeCopied, setBadgeCopied] = useState(false);
  const [filterLinkCopied, setFilterLinkCopied] = useState(false);
  const [sharedView, setSharedView] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [filterFollowers, setFilterFollowers] = useState(0);
  const [followerMapFilter, setFollowerMapFilter] = useState<"all" | "high" | "mid" | "low">("all");
  const [clusterRadius, setClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [debouncedClusterRadius, setDebouncedClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [filterDate, setFilterDate] = useState<"all" | "30d" | "90d" | "1y">("all");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; login: string } | null>(null);
  const [growthOpen, setGrowthOpen] = useState(false);
  const { watchActive, watchNewCount, watchCountries, handleWatchStart, handleWatchStop } = useWatchMode(owner, repo);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [storedUsername, setStoredUsernameState] = useState("");
  const [repoNotFound, setRepoNotFound] = useState(false);
  const [repoRateLimited, setRepoRateLimited] = useState(false);
  const mapControlsRef = useRef<{
    captureCanvas: () => Promise<string | null>;
    setViewMode: (mode: "clusters" | "heatmap") => void;
    toggleProjection: () => MapProjection;
    getProjection: () => MapProjection;
  } | null>(null);
  const [mapProjection, setMapProjection] = useState<MapProjection>("globe");
  const [viewMode, setViewMode] = useState<"clusters" | "heatmap">("clusters");
  // Timelapse + filtered map points — weekBuckets and filteredMapPoints are derived inside
  const {
    timelapseActive, setTimelapseActive,
    timelapseIndex, setTimelapseIndex,
    timelapseAutoPlay, setTimelapseAutoPlay,
    timelapseSpeed, setTimelapseSpeed,
    weekBuckets, filteredMapPoints,
  } = useTimelapse(points, followerMapFilter);

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

  // Read compare + filter params from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const compare = p.get("compare");
    if (compare && compare.includes("/") && compare.split("/").length === 2) {
      const [o, r] = compare.split("/");
      if (o && r) { setCompareOwner(o); setCompareRepo(r); }
    }
    // Deep-link filter restore
    let hasSharedState = false;
    const country = p.get("country");
    const city = p.get("city");
    const company = p.get("company");
    const followers = p.get("followers");
    const date = p.get("date");
    const tier = p.get("tier");
    const mode = p.get("mode");
    const proj = p.get("proj");
    if (country) { setFilterCountry(country); hasSharedState = true; }
    if (city) { setFilterCity(city); hasSharedState = true; }
    if (company) { setFilterCompany(company); hasSharedState = true; }
    if (followers) { const n = parseInt(followers, 10); if (n > 0) { setFilterFollowers(n); hasSharedState = true; } }
    if (date && (["30d", "90d", "1y"] as string[]).includes(date)) { setFilterDate(date as "30d" | "90d" | "1y"); hasSharedState = true; }
    if (tier && (["high", "mid", "low"] as string[]).includes(tier)) { setFollowerMapFilter(tier as "high" | "mid" | "low"); hasSharedState = true; }
    if (mode === "heatmap") { setViewMode("heatmap"); hasSharedState = true; }
    if (proj === "mercator") { setMapProjection("mercator"); hasSharedState = true; }
    if (hasSharedState) setSharedView(true);
  }, []);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  const {
    status, setStatus,
    retryIn, retryTotal, waitReason, error,
    startScraping,
    handleStartScan, handleStartRefresh, handleTokenClose,
  } = useScanController({
    owner, repo, dispatch, scanRef,
    setTotal, setCachedAt, setLatestStarredAt,
    setTokenOpen, setHasToken, setServerStats,
    ghHeaders, repoInfo, total, latestStarredAt,
  });

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
    const ac = new AbortController();
    const t = getStoredToken();
    fetch(`/api/repo-info?owner=${owner}&repo=${repo}`, {
      headers: t ? { "x-gh-token": t } : {},
      signal: ac.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401 || r.status === 429) { setRepoRateLimited(true); return; }
        if (!r.ok || data.error) { setRepoNotFound(true); return; }
        setRepoInfo(data);
        setTotal((t2) => t2 || data.stars);
      })
      .catch((e: unknown) => { if ((e as { name?: string })?.name !== "AbortError") setRepoNotFound(true); });
    return () => ac.abort();
  }, [owner, repo]);

  const { cacheCheckDone, lastDbScan } = useRepoCacheLoader({
    owner, repo, repoInfo,
    dispatch, setTotal, setCachedAt, setLatestStarredAt, setStatus, setServerStats,
  });

  // Fetch organic score independently — reads badge_cache directly, no star_event dependency
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/organic-score/${owner}/${repo}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { organic: RepoOrganic } | null) => { if (data?.organic) setOrganicData(data.organic); })
      .catch(() => {});
    return () => ac.abort();
  }, [owner, repo]);

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
    } catch {
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

  // Show growth button whenever the repo has any scan data (API will provide timestamps)
  const hasGrowthData = points.length > 0 || unmapped.length > 0;

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
    return { topCountries, topCities, topUsers, topCompanies, mappingRate, countryCount: countryCount.size, avgFollowers, totalStars, mappedCount: deferredPointsForStats.length, botCount: 0, enrichedUserCount: 0, powerStargazers: [] as RepoStats["powerStargazers"], isCapped: false, organic: null };
  }, [deferredPointsForStats, unmapped]);

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const estimate = total > 0 ? estimateScan(total) : null;
  const newStarsCount = repoInfo && total > 0 ? Math.max(0, repoInfo.stars - total) : 0;
  // Client-side stats take priority; fall back to server stats when no points loaded yet
  const displayStats = stats ?? serverStats;

  // Stars gained in the last 30 days (based on starredAt already in memory)
  const starsThisMonth = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return points.filter((p) => p.starredAt && new Date(p.starredAt).getTime() >= cutoff).length;
  }, [points]);

  // Build a filtered-view URL encoding current filter state
  const buildFilteredUrl = useCallback((): string => {
    const params = new URLSearchParams();
    if (filterCountry) params.set("country", filterCountry);
    if (filterCity) params.set("city", filterCity);
    if (filterCompany) params.set("company", filterCompany);
    if (filterFollowers > 0) params.set("followers", String(filterFollowers));
    if (filterDate !== "all") params.set("date", filterDate);
    if (followerMapFilter !== "all") params.set("tier", followerMapFilter);
    if (viewMode !== "clusters") params.set("mode", viewMode);
    if (mapProjection !== "globe") params.set("proj", String(mapProjection));
    const base = `${window.location.origin}${window.location.pathname}`;
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [filterCountry, filterCity, filterCompany, filterFollowers, filterDate, followerMapFilter, viewMode, mapProjection]);

  const hasActiveFilters = !!(filterCountry || filterCity || filterCompany || filterFollowers > 0 || filterDate !== "all" || followerMapFilter !== "all" || viewMode !== "clusters");

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
                  <button
                    type="button"
                    onClick={handleStartScan}
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

      {/* Shared-view banner — shown when URL encoded filters were detected on load */}
      {sharedView && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20
          bg-accent-blue/10 border border-accent-blue/30 rounded-lg px-4 py-2
          text-xs backdrop-blur-md flex items-center gap-3 max-w-sm shadow-md">
          <span className="text-accent-blue font-medium">Shared view</span>
          {filterCountry && <span className="text-muted-subtle">{filterCountry}</span>}
          {filterCity && <span className="text-muted-subtle">{filterCity}</span>}
          {filterCompany && <span className="text-muted-subtle">{filterCompany}</span>}
          {filterFollowers > 0 && <span className="text-muted-subtle">{filterFollowers}+ flw</span>}
          {filterDate !== "all" && <span className="text-muted-subtle">{filterDate}</span>}
          {followerMapFilter !== "all" && <span className="text-muted-subtle">{followerMapFilter}</span>}
          <button
            onClick={() => setSharedView(false)}
            aria-label="Dismiss"
            className="ml-auto text-muted hover:text-foreground leading-none"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

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
          flex flex-col max-h-[45dvh]">
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
          watchActive={watchActive}
          watchNewCount={watchNewCount}
          watchCountries={watchCountries}
          onWatchStart={handleWatchStart}
          onWatchStop={handleWatchStop}
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
      <AllStargazersModal
        open={allOpen}
        onClose={() => setAllOpen(false)}
        allStargazers={allStargazers}
        points={points}
        filterCountry={filterCountry}
        setFilterCountry={setFilterCountry}
        filterCity={filterCity}
        setFilterCity={setFilterCity}
        filterCompany={filterCompany}
        setFilterCompany={setFilterCompany}
        filterFollowers={filterFollowers}
        setFilterFollowers={setFilterFollowers}
        filterDate={filterDate}
        setFilterDate={setFilterDate}
        setFlyTarget={setFlyTarget}
        ghHeaders={ghHeaders}
        owner={owner}
        repo={repo}
      />

      {/* Growth chart modal */}
      <GrowthModal
        open={growthOpen}
        onClose={() => setGrowthOpen(false)}
        owner={owner}
        repo={repo}
        points={points}
        unmapped={unmapped}
      />

      {/* Share modal */}
      {repoInfo && (
      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="Share" maxWidth="max-w-lg">


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
              {/* Current view deep link — only shown when filters are active */}
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
      )}

      {/* Badge modal */}
      <BadgeModal
        open={badgeOpen}
        onClose={() => setBadgeOpen(false)}
        owner={owner}
        repo={repo}
      />

      {/* Stats modal */}
      {displayStats && (
        <StatsModal
          open={statsOpen}
          onClose={() => setStatsOpen(false)}
          owner={owner}
          repo={repo}
          displayStats={displayStats}
          starsThisMonth={starsThisMonth}
        />
      )}
    </main>
  );
}
