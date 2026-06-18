// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState, useCallback, useMemo, useDeferredValue, useReducer } from "react";
import dynamic from "next/dynamic";
import { useScanController, scanReducer } from "@/hooks/useScanController";
import type { AnyStargazer } from "@/components/map/all-stargazers-modal";

const StatsModal = dynamic(() => import("@/components/map/stats-modal").then((m) => ({ default: m.StatsModal })), { ssr: false });
const BadgeModal = dynamic(() => import("@/components/map/badge-modal").then((m) => ({ default: m.BadgeModal })), { ssr: false });
const GrowthModal = dynamic(() => import("@/components/map/growth-modal").then((m) => ({ default: m.GrowthModal })), { ssr: false });
const AllStargazersModal = dynamic(() => import("@/components/map/all-stargazers-modal").then((m) => ({ default: m.AllStargazersModal })), { ssr: false });
const RateLimitedModal = dynamic(() => import("@/components/map/rate-limited-modal").then((m) => ({ default: m.RateLimitedModal })), { ssr: false });
const RepoNotFoundModal = dynamic(() => import("@/components/map/not-found-modal").then((m) => ({ default: m.RepoNotFoundModal })), { ssr: false });
import { RateLimitOverlay } from "@/components/map/rate-limit-overlay";
import { PreScanOverlay } from "@/components/map/pre-scan-overlay";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { MapFloatingNav } from "@/components/map/map-floating-nav";
import { CLUSTER_RADIUS } from "@/components/map/constants";
import type { MapProjection } from "@/lib/map-style-urls";
import type { RepoStats, RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import { getStoredToken, getStoredUsername, setStoredUsername } from "@/lib/token";
import { MapTourAutoStart } from "@/components/tour/tour-provider";
import { isCountry, normalizeCountry } from "@/lib/countries";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/map-style-urls";
import { TopPanel } from "@/components/map/top-panel";
import { Dock } from "@/components/map/dock";
const TokenModal = dynamic(() => import("@/components/token-modal").then((m) => ({ default: m.TokenModal })), { ssr: false });
const TimelapseBar = dynamic(() => import("@/components/map/timelapse-bar").then((m) => ({ default: m.TimelapseBar })), { ssr: false });
import type { TimeEstimate } from "@/lib/format";
import { useWatchMode } from "@/hooks/useWatchMode";
import { useTimelapse } from "@/hooks/useTimelapse";
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";
import { useCompareScan } from "@/hooks/use-compare-scan";
const ShareModal = dynamic(() => import("@/components/map/share-modal").then((m) => ({ default: m.ShareModal })), { ssr: false });

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
  contributorsCount: number | null;
};

type Props = {
  owner: string;
  repo: string;
  initialRepoInfo: RepoInfo | null;
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

export default function MapPageClient({ owner, repo, initialRepoInfo }: Props) {
  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [scan, dispatch] = useReducer(scanReducer, { points: [], unmapped: [], processed: 0 });
  const { points, unmapped, processed } = scan;
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(initialRepoInfo);

  const [total, setTotal] = useState(() => initialRepoInfo?.stars ?? 0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerContainerRef = useRef<HTMLDivElement>(null);
  const [drawerScrollTop, setDrawerScrollTop] = useState(0);
  const [drawerCols, setDrawerCols] = useState(2);
  const [drawerVisibleRows, setDrawerVisibleRows] = useState(8);
  const [findInput, setFindInput] = useState("");
  const [findStatus, setFindStatus] = useState<"idle" | "searching" | "found" | "no-location" | "not-found">("idle");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [latestStarredAt, setLatestStarredAt] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<RepoStats | null>(null);
  const [organicData, setOrganicData] = useState<RepoOrganic | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [liDraft, setLiDraft] = useState("");
  const [sharedView, setSharedView] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [filterFollowers, setFilterFollowers] = useState(0);
  const [followerMapFilter, setFollowerMapFilter] = useState<"all" | "elite" | "vhigh" | "high" | "mid" | "low">("all");
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

  // Debounce clusterRadius changes: map rebuild fires 150ms after slider stops
  useEffect(() => {
    const t = setTimeout(() => setDebouncedClusterRadius(clusterRadius), 150);
    return () => clearTimeout(t);
  }, [clusterRadius]);

  // Drawer: detect column count from container width for virtual scroll calculation
  useEffect(() => {
    if (!drawerOpen) return;
    const el = drawerContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setDrawerCols(w >= 1024 ? 5 : w >= 768 ? 4 : w >= 640 ? 3 : 2);
      setDrawerVisibleRows(Math.max(3, Math.ceil(el.clientHeight / 48)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerOpen]);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  const {
    compareOwner, setCompareOwner,
    compareRepo, setCompareRepo,
    comparePoints, compareStatus, compareInfo,
  } = useCompareScan(ghHeaders);

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
  }, [setCompareOwner, setCompareRepo]);

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

  // Client-side fallback: only fires if server pre-fetch failed (private repo, rate limit, network error)
  useEffect(() => {
    if (initialRepoInfo !== null) return;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo]); // initialRepoInfo is stable after mount — intentionally excluded

  const { cacheCheckDone, lastDbScan } = useRepoCacheLoader({
    owner, repo, repoInfo,
    currentStars: initialRepoInfo?.stars,
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

  // Sync viewMode to map imperatively (no re-render)
  useEffect(() => {
    mapControlsRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (compareOwner && compareRepo) setViewMode("clusters");
  }, [compareOwner, compareRepo]);

  // Deferred values: defer both points and unmapped so per-chunk re-renders
  // don't block the main thread on full-array rebuilds (allStargazers + stats).
  const deferredPointsForStats = useDeferredValue(points);
  const deferredUnmapped = useDeferredValue(unmapped);

  const allStargazers = useMemo<AnyStargazer[]>(() => [
    ...deferredPointsForStats.map((p) => ({
      login: p.login, name: p.name, bio: p.bio, company: p.company,
      followers: p.followers, location: p.location ?? null,
      avatarUrl: p.avatarUrl, mapped: true, starredAt: p.starredAt ?? null,
    })),
    ...deferredUnmapped.map((u) => ({
      login: u.login, name: u.name, bio: null, company: null,
      followers: u.followers, location: null,
      avatarUrl: null, mapped: false, starredAt: u.starredAt ?? null,
    })),
  ], [deferredPointsForStats, deferredUnmapped]);

  const hasGrowthData = points.length > 0 || unmapped.length > 0;

  const DRAWER_ROW_H = 48;
  const DRAWER_OVERSCAN = 3;
  const sortedUnmapped = useMemo(
    () => [...unmapped].sort((a, b) => b.followers - a.followers),
    [unmapped]
  );
  const drawerRowCount = Math.ceil(sortedUnmapped.length / drawerCols);
  const drawerVStartRow = Math.max(0, Math.floor(drawerScrollTop / DRAWER_ROW_H) - DRAWER_OVERSCAN);
  const drawerVEndRow = Math.min(drawerRowCount, drawerVStartRow + drawerVisibleRows + DRAWER_OVERSCAN * 2);
  const drawerVStartIdx = drawerVStartRow * drawerCols;
  const drawerVEndIdx = Math.min(sortedUnmapped.length, drawerVEndRow * drawerCols);
  const drawerPadTop = drawerVStartRow * DRAWER_ROW_H;
  const drawerPadBottom = (drawerRowCount - drawerVEndRow) * DRAWER_ROW_H;

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
    const scannedTotal = deferredPointsForStats.length + unmapped.length;
    // Use current GitHub star count as source of truth — cached scan data can be older than the current count
    const totalStars = repoInfo?.stars ?? scannedTotal;
    const mappingRate = totalStars > 0 ? Math.round((deferredPointsForStats.length / totalStars) * 100) : 0;
    const avgFollowers = deferredPointsForStats.length > 0
      ? Math.round(deferredPointsForStats.reduce((s, p) => s + p.followers, 0) / deferredPointsForStats.length)
      : 0;
    // botCount, enrichedUserCount, powerStargazers come from server stats only (requires dataVersion + cross-repo query)
    return { topCountries, topCities, topUsers, topCompanies, mappingRate, countryCount: countryCount.size, avgFollowers, totalStars, mappedCount: deferredPointsForStats.length, botCount: 0, enrichedUserCount: 0, powerStargazers: [] as RepoStats["powerStargazers"], isCapped: false, organic: null };
  }, [deferredPointsForStats, unmapped, repoInfo]);

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const estimate = useMemo(() => total > 0 ? estimateScan(total) : null, [total]);
  const newStarsCount = repoInfo && total > 0 ? Math.max(0, repoInfo.stars - total) : 0;
  const displayStats = stats ?? serverStats;

  // Captured once on mount: Date.now() is impure, so it cannot run inside the useMemo
  // render computation (react-hooks/purity). A 30-day window does not shift meaningfully
  // within a single session, so a mount-time "now" is fine.
  const [nowMs] = useState(() => Date.now());
  const starsThisMonth = useMemo(() => {
    const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
    return points.filter((p) => p.starredAt && new Date(p.starredAt).getTime() >= cutoff).length;
  }, [points, nowMs]);

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

      <MapTourAutoStart status={status} hasPoints={points.length > 0} />

      {/* Global screen-reader live region for scan progress, errors, and status changes */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status === "loading" && total > 0 && `${processed.toLocaleString()} of ${total.toLocaleString()} stargazers loaded`}
        {status === "done" && `Scan complete: ${processed.toLocaleString()} stargazers loaded`}
        {status === "error" && error ? `Error: ${error}` : null}
      </div>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}

      <RateLimitedModal
        open={repoRateLimited}
        onAddToken={() => { setRepoRateLimited(false); setTokenOpen(true); }}
      />

      <RepoNotFoundModal open={repoNotFound} owner={owner} repo={repo} />

      <StargazerMapDynamic
        points={filteredMapPoints}
        comparePoints={comparePoints}
        flyTarget={flyTarget}
        onFlyDone={handleFlyDone}
        onReady={handleMapReady}
        styleUrl={mapStyleUrl}
        clusterRadius={debouncedClusterRadius}
      />

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

      {repoInfo && estimate && (
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
      )}

      <RateLimitOverlay
        status={status}
        waitReason={waitReason}
        retryIn={retryIn}
        retryTotal={retryTotal}
      />

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

      {compareOwner && compareRepo && (
        <div className="absolute bottom-6 right-4 z-10
          bg-background/90 border border-border rounded-lg px-3 py-2
          text-xs backdrop-blur-md select-none flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-purple flex-shrink-0" />
          <span className="text-muted text-2xs truncate max-w-28">{compareRepo}</span>
        </div>
      )}

      {drawerOpen && (
        <div
          role="region"
          aria-label="Unmapped stargazers"
          onKeyDown={(e) => { if (e.key === "Escape") setDrawerOpen(false); }}
          className="absolute bottom-0 left-0 right-0 z-20
          bg-background/95 border-t border-border backdrop-blur-md
          flex flex-col max-h-[45dvh]"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle flex-shrink-0">
            <div>
              <span className="text-sm text-muted">
                <strong className="text-foreground">{unmapped.length.toLocaleString()} stargazers</strong> without location
              </span>
              <span className="ml-2 text-2xs text-muted-subtle">(no location set on their GitHub profile)</span>
            </div>
            <button onClick={() => setDrawerOpen(false)} aria-label="Close unmapped list" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
          </div>
          <div
            ref={drawerContainerRef}
            className="overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            onScroll={(e) => setDrawerScrollTop(e.currentTarget.scrollTop)}
          >
            {drawerPadTop > 0 && <div className="col-span-full" style={{ height: drawerPadTop }} />}
            {sortedUnmapped.slice(drawerVStartIdx, drawerVEndIdx).map((u) => (
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
            {drawerPadBottom > 0 && <div className="col-span-full" style={{ height: drawerPadBottom }} />}
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

      <GrowthModal
        open={growthOpen}
        onClose={() => setGrowthOpen(false)}
        owner={owner}
        repo={repo}
        points={points}
        unmapped={unmapped}
        totalCount={repoInfo?.stars ?? total}
      />

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
          liDraft={liDraft}
          onLiDraftChange={setLiDraft}
        />
      )}

      <BadgeModal
        open={badgeOpen}
        onClose={() => setBadgeOpen(false)}
        owner={owner}
        repo={repo}
      />

      {displayStats && (
        <StatsModal
          open={statsOpen}
          onClose={() => setStatsOpen(false)}
          owner={owner}
          repo={repo}
          displayStats={displayStats}
          starsThisMonth={starsThisMonth}
          contributorsCount={repoInfo?.contributorsCount ?? null}
        />
      )}
    </main>
  );
}
