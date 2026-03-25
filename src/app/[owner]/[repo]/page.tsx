"use client";

import { use, useEffect, useRef, useState, useCallback, useMemo, useDeferredValue } from "react";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { saveBookmark } from "@/lib/bookmarks";
import { FilterCombobox } from "@/components/filter-combobox";

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

interface RepoInfo {
  name: string;
  description: string | null;
  stars: number;
  avatar: string | null;
}

interface TimeEstimate {
  min: number;
  max: number;
  unit: "sec" | "min" | "h";
  keepOpen: boolean;
}

interface LocalCache {
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

function estimateScan(stars: number): TimeEstimate {
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

function formatEstimate(e: TimeEstimate): string {
  if (e.min === e.max) return `~${e.min} ${e.unit}`;
  return `${e.min}–${e.max} ${e.unit}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}min ago`;
  return "just now";
}

const RETRY_DELAY = 8;

class RateLimitedError extends Error {
  constructor() { super("rate_limited"); }
}

export default function MapPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = use(params);
  const [points, setPoints] = useState<StargazerPoint[]>([]);
  const [unmapped, setUnmapped] = useState<{ login: string; name: string | null; followers: number; starredAt: string | null }[]>([]);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "waiting" | "done" | "cached" | "refreshing" | "error">("idle");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [retryIn, setRetryIn] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [findInput, setFindInput] = useState("");
  const [findStatus, setFindStatus] = useState<"idle" | "searching" | "found" | "no-location" | "not-found">("idle");
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [latestStarredAt, setLatestStarredAt] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsTab, setStatsTab] = useState<"countries" | "cities" | "top" | "companies">("top");
  const [statsFilter, setStatsFilter] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [liPanelOpen, setLiPanelOpen] = useState(false);
  const [liDraft, setLiDraft] = useState("");
  const [liCopied, setLiCopied] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [allSearch, setAllSearch] = useState("");
  const deferredSearch = useDeferredValue(allSearch);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableVisibleCount, setTableVisibleCount] = useState(14);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [allSort, setAllSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "followers", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [filterFollowers, setFilterFollowers] = useState(0);
  const [filterMapped, setFilterMapped] = useState<"all" | "mapped" | "unmapped">("all");
  const [followerMapFilter, setFollowerMapFilter] = useState<"all" | "high" | "mid" | "low">("all");
  const [filterDate, setFilterDate] = useState<"all" | "30d" | "90d" | "1y">("all");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; login: string } | null>(null);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const captureMapRef = useRef<(() => Promise<string | null>) | null>(null);
  const runningRef = useRef(false);

  // Compare repo state
  const [compareOwner, setCompareOwner] = useState<string | null>(null);
  const [compareRepo, setCompareRepo] = useState<string | null>(null);
  const [comparePoints, setComparePoints] = useState<StargazerPoint[]>([]);
  const [compareStatus, setCompareStatus] = useState<"idle" | "loading" | "done">("idle");
  const [compareInfo, setCompareInfo] = useState<RepoInfo | null>(null);
  const compareRunningRef = useRef(false);

  // Read compare param from URL on mount
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("compare");
    if (p && p.includes("/")) {
      const [o, r] = p.split("/");
      setCompareOwner(o);
      setCompareRepo(r);
    }
  }, []);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  // Load repo info
  useEffect(() => {
    const t = getStoredToken();
    fetch(`/api/repo-info?owner=${owner}&repo=${repo}`, {
      headers: t ? { "x-gh-token": t } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) { setRepoInfo(data); setTotal((t2) => t2 || data.stars); }
      })
      .catch(() => {});
  }, [owner, repo]);

  // Load from localStorage cache on mount
  useEffect(() => {
    const cache = loadCache(owner, repo);
    if (!cache) return;
    setPoints(cache.points);
    setUnmapped(cache.unmapped);
    setTotal(cache.totalCount);
    setProcessed(cache.totalCount);
    setCachedAt(cache.scannedAt);
    setLatestStarredAt(cache.latestStarredAt);
    setStatus("cached");
    saveBookmark(owner, repo, cache.totalCount);
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
    if (res.status === 429) throw new RateLimitedError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ChunkResponse;
  }, [owner, repo]);

  // Full scan from scratch
  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    clearCache(owner, repo);
    setPoints([]);
    setUnmapped([]);
    setProcessed(0);
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
              setStatus("waiting");
              setRetryIn(RETRY_DELAY);
              await new Promise((r) => setTimeout(r, RETRY_DELAY * 1000));
              setStatus("loading");
            } else {
              throw e;
            }
          }
        }

        if (!newestStarredAt && chunk!.latestStarredAt) newestStarredAt = chunk!.latestStarredAt;
        setTotal(chunk!.totalCount);
        const newPts = chunk!.points;
        const newUnmapped = chunk!.unmapped;
        allPoints = [...allPoints, ...newPts];
        allUnmapped = [...allUnmapped, ...newUnmapped];
        setPoints(allPoints);
        setUnmapped(allUnmapped);
        setProcessed(allPoints.length + allUnmapped.length);
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      const now = Date.now();
      setCachedAt(now);
      setLatestStarredAt(newestStarredAt);
      saveCache(owner, repo, {
        points: allPoints,
        unmapped: allUnmapped,
        totalCount: total,
        scannedAt: now,
        latestStarredAt: newestStarredAt,
      });
      saveBookmark(owner, repo, allPoints.length + allUnmapped.length);

      // Update badge cache (fire-and-forget)
      const countrySet = new Set(
        allPoints
          .map((p) => p.location?.split(",").pop()?.trim())
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
        }),
      }).catch(() => {});

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
              setStatus("waiting");
              setRetryIn(RETRY_DELAY);
              await new Promise((r) => setTimeout(r, RETRY_DELAY * 1000));
              setStatus("refreshing");
            } else {
              throw e;
            }
          }
        }

        if (!newestStarredAt && chunk!.latestStarredAt) newestStarredAt = chunk!.latestStarredAt;
        latestTotalCount = chunk!.totalCount;
        setTotal(chunk!.totalCount);
        newPoints = [...newPoints, ...chunk!.points];
        newUnmapped = [...newUnmapped, ...chunk!.unmapped];
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      const now = Date.now();
      // Merge new data (prepend — newest first in display doesn't matter, just no dupes)
      setPoints((prev) => {
        const existing = new Set(prev.map((p) => p.login));
        return [...newPoints.filter((p) => !existing.has(p.login)), ...prev];
      });
      setUnmapped((prev) => [...newUnmapped, ...prev]);
      setCachedAt(now);

      const updatedLatest = newestStarredAt ?? latestStarredAt;
      setLatestStarredAt(updatedLatest);

      // Save updated cache — use latestTotalCount (local var) to avoid stale closure on `total`
      setPoints((pts) => {
        setUnmapped((unm) => {
          saveCache(owner, repo, {
            points: pts,
            unmapped: unm,
            totalCount: latestTotalCount,
            scannedAt: now,
            latestStarredAt: updatedLatest,
          });
          return unm;
        });
        return pts;
      });
      setStatus("cached");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [fetchNextChunk, latestStarredAt, owner, repo, total]);

  const startCompareScan = useCallback(async () => {
    if (!compareOwner || !compareRepo || compareRunningRef.current) return;
    compareRunningRef.current = true;
    setCompareStatus("loading");
    let cursor: string | null = null;
    const allPts: StargazerPoint[] = [];
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
        setComparePoints([...allPts]);
        if (!chunk.nextCursor) break;
        cursor = chunk.nextCursor;
      }
    } catch {}
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

  const filteredMapPoints = useMemo(() => {
    if (followerMapFilter === "all") return points;
    if (followerMapFilter === "high") return points.filter((p) => p.followers >= 500);
    if (followerMapFilter === "mid") return points.filter((p) => p.followers >= 100 && p.followers < 500);
    return points.filter((p) => p.followers < 100);
  }, [points, followerMapFilter]);

  const growthData = useMemo(() => {
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
  }, [points, unmapped]);

  const filteredStargazers = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    let list = allStargazers;
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
  }, [allStargazers, deferredSearch, allSort, filterFollowers, filterMapped, filterDate, filterCompany, filterCountry, filterCity]);

  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of allStargazers) {
      const c = u.location?.split(",").pop()?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
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

  const findUser = useCallback(() => {
    const raw = findInput.trim();
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

  const stats = useMemo(() => {
    if (!points.length) return null;
    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    const companyCount = new Map<string, number>();
    for (const p of points) {
      if (p.location) {
        const parts = p.location.split(",").map((s) => s.trim()).filter(Boolean);
        const country = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        const city = parts[0];
        if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + 1);
        if (parts.length > 1 && city) cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
      }
      if (p.company) {
        const c = p.company.trim();
        if (c) companyCount.set(c, (companyCount.get(c) ?? 0) + 1);
      }
    }
    const topCountries = [...countryCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const topCities = [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const topUsers = [...points].sort((a, b) => b.followers - a.followers).slice(0, 20);
    const topCompanies = [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const mappingRate = Math.round((points.length / (points.length + unmapped.length)) * 100);
    const avgFollowers = points.length > 0
      ? Math.round(points.reduce((s, p) => s + p.followers, 0) / points.length)
      : 0;
    return { topCountries, topCities, topUsers, topCompanies, mappingRate, countryCount: countryCount.size, avgFollowers };
  }, [points, unmapped]);

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const estimate = total > 0 ? estimateScan(total) : null;
  const newStarsCount = repoInfo && total > 0 ? Math.max(0, repoInfo.stars - total) : 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0d1117]">

      {tokenOpen && <TokenModal onClose={() => setTokenOpen(false)} />}

      {/* Top-right token button */}
      <button
        onClick={() => setTokenOpen(true)}
        className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
          getStoredToken()
            ? "border-[#238636] text-[#3fb950] bg-[#0d1117]/80 hover:bg-[#238636]/10"
            : "border-[#30363d] text-[#8b949e] bg-[#0d1117]/80 hover:text-[#f0f6fc] hover:border-[#58a6ff]"
        }`}
        title="GitHub access token"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
        </svg>
        {getStoredToken() ? "Token set" : "Add token"}
      </button>

      {/* Map */}
      <StargazerMapDynamic
        points={filteredMapPoints}
        comparePoints={comparePoints}
        flyTarget={flyTarget}
        onFlyDone={() => setFlyTarget(null)}
        onReady={(fn) => { captureMapRef.current = fn; }}
      />

      {/* Pre-scan overlay (no cache) */}
      {status === "idle" && repoInfo && estimate && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(13,17,23,0.85)] backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              {repoInfo.avatar && (
                <img src={repoInfo.avatar} alt="" className="w-10 h-10 rounded-full" />
              )}
              <div>
                <div className="text-[#f0f6fc] font-semibold">{repoInfo.name}</div>
                {repoInfo.description && (
                  <div className="text-[#8b949e] text-xs mt-0.5 line-clamp-1">{repoInfo.description}</div>
                )}
              </div>
            </div>

            <div className="flex gap-4 mb-6">
              <div className="flex-1 bg-[#0d1117] rounded-lg px-4 py-3 text-center">
                <div className="text-2xl font-bold text-[#f0f6fc]">{total.toLocaleString()}</div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">stars</div>
              </div>
              <div className="flex-1 bg-[#0d1117] rounded-lg px-4 py-3 text-center">
                <div className="text-2xl font-bold text-[#58a6ff]">{formatEstimate(estimate)}</div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">estimated</div>
              </div>
            </div>

            {estimate.keepOpen && (
              <div className="flex items-start gap-2.5 bg-[#271d0e] border border-[#ffa657]/30 rounded-lg px-4 py-3 mb-6">
                <span className="text-[#ffa657] mt-0.5 flex-shrink-0">⚠</span>
                <p className="text-[#ffa657] text-xs leading-relaxed">
                  Keep this tab open during indexing. Closing it will restart from scratch.
                  {estimate.unit === "h" && " Consider running this overnight."}
                </p>
              </div>
            )}

            <p className="text-[#8b949e] text-xs mb-6 leading-relaxed">
              Stargazers are geocoded via their GitHub location field.
              Subsequent visits will load instantly from local cache.
            </p>

            <button
              onClick={startScraping}
              className="w-full bg-[#238636] hover:bg-[#2ea043] text-white font-medium py-3 rounded-lg transition-colors text-sm"
            >
              Start indexing {total.toLocaleString()} stars →
            </button>
          </div>
        </div>
      )}

      {/* Rate limit overlay */}
      {status === "waiting" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(13,17,23,0.75)] backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-center">
            <div className="flex justify-center mb-5">
              <svg className="animate-spin w-10 h-10 text-[#58a6ff]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
            <h2 className="text-[#f0f6fc] font-semibold text-base mb-1">Server busy</h2>
            <p className="text-[#8b949e] text-sm mb-5">
              Too many scans running at once. Resuming automatically in
            </p>
            <div className="text-5xl font-bold text-[#58a6ff] tabular-nums mb-5">{retryIn}</div>
            <div className="w-full bg-[#21262d] rounded-full h-1 overflow-hidden">
              <div
                className="bg-[#58a6ff] h-full rounded-full transition-all duration-1000"
                style={{ width: `${((RETRY_DELAY - retryIn) / RETRY_DELAY) * 100}%` }}
              />
            </div>
            <p className="text-[#484f58] text-xs mt-4">Your progress is saved — no need to do anything.</p>
          </div>
        </div>
      )}

      {/* Top panel */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10
        bg-[rgba(13,17,23,0.92)] border border-[#30363d] rounded-xl
        px-5 py-3 text-center backdrop-blur-md shadow-2xl min-w-[320px]">

        <div className="flex items-center justify-center gap-2 mb-1">
          {repoInfo?.avatar && (
            <img src={repoInfo.avatar} alt="" className="w-5 h-5 rounded-full" />
          )}
          <a
            href={`https://github.com/${owner}/${repo}`}
            target="_blank"
            className="text-[#f0f6fc] text-sm font-semibold hover:underline"
          >
            {owner}/{repo}
          </a>
        </div>

        {compareOwner && compareRepo && (
          <div className="mt-1 flex items-center justify-center gap-2 text-[10px]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#a371f7] flex-shrink-0" />
            <span className="text-[#8b949e]">
              vs <span className="text-[#a371f7]">{compareOwner}/{compareRepo}</span>
              {compareInfo && <span className="text-[#484f58] ml-1">({compareInfo.stars.toLocaleString()} ★)</span>}
              {compareStatus === "loading" && <span className="text-[#484f58] ml-1">· scanning…</span>}
              {compareStatus === "done" && <span className="text-[#484f58] ml-1">· {comparePoints.length} mapped</span>}
            </span>
          </div>
        )}

        <div className="flex gap-5 justify-center mt-2">
          {[
            { val: points.length.toLocaleString(), label: "mapped" },
            { val: total.toLocaleString() || "—", label: "total stars" },
            { val: new Set(points.map((p) => p.location?.split(",").pop()?.trim())).size.toString(), label: "locations" },
          ].map(({ val, label }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold text-[#f0f6fc]">{val}</div>
              <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-center cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div className="text-2xl font-bold text-[#8b949e]">{unmapped.length.toLocaleString()}</div>
            <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">no location</div>
          </button>
        </div>

        {/* Progress bar */}
        {(status === "loading" || status === "refreshing" || status === "waiting") && (
          <div className="mt-3">
            <div className="w-full bg-[#21262d] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-[#58a6ff] h-full rounded-full transition-all duration-300"
                style={{ width: status === "refreshing" ? "100%" : `${pct}%` }}
              />
            </div>
            <div className="text-[10px] text-[#8b949e] mt-1">
              {status === "waiting"
                ? `⏸ Queued — resuming in ${retryIn}s…`
                : status === "refreshing"
                ? "↻ Fetching new stars…"
                : `Fetching ${processed.toLocaleString()} / ${total.toLocaleString()} — ${pct}%`
              }
              {estimate && status === "loading" && (
                <span className="ml-1 text-[#484f58]">· est. {formatEstimate(estimate)}</span>
              )}
            </div>
          </div>
        )}

        {/* Mapping ratio progress bar — always visible when data available */}
        {(status === "cached" || status === "done") && total > 0 && points.length > 0 && (
          <div className="mt-2.5">
            <div className="w-full bg-[#21262d] rounded-full h-1 overflow-hidden">
              <div
                className="bg-[#58a6ff] h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.round((points.length / total) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-[#484f58] mt-0.5 text-center">
              {points.length.toLocaleString()} / {total.toLocaleString()} mapped ({Math.round((points.length / total) * 100)}%)
            </div>
          </div>
        )}

        {/* Cache status */}
        {(status === "cached" || status === "done") && cachedAt && (
          <div className="mt-2 flex items-center justify-center gap-3">
            <span className="text-[10px] text-[#3fb950]">
              {status === "done" ? "✓ Indexed" : `✓ Cached ${timeAgo(cachedAt)}`}
            </span>
            {status === "cached" && latestStarredAt && (
              <button
                onClick={startRefresh}
                className="text-[10px] text-[#58a6ff] hover:underline flex items-center gap-1"
              >
                ↻ {newStarsCount > 0 ? `${newStarsCount} new stars` : "Refresh"}
              </button>
            )}
            <button
              onClick={startScraping}
              className="text-[10px] text-[#8b949e] hover:text-[#f0f6fc] hover:underline"
            >
              Full rescan
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="mt-2 text-[#f85149] text-xs">{error}</div>
        )}

        {/* Find me */}
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              value={findInput}
              onChange={(e) => { setFindInput(e.target.value); setFindStatus("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter") findUser(); }}
              placeholder="GitHub username or URL…"
              className="flex-1 bg-[#21262d] border border-[#30363d] rounded-md px-3 py-1.5 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
            />
            <button
              onClick={findUser}
              disabled={findStatus === "searching"}
              className="bg-[#21262d] border border-[#30363d] rounded-md px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#30363d] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {findStatus === "searching" ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Searching…
                </>
              ) : "Find"}
            </button>
          </div>
          {findStatus === "found" && (
            <p className="text-[10px] text-[#3fb950]">✓ Found — flying to location</p>
          )}
          {findStatus === "no-location" && (
            <p className="text-[10px] text-[#f0883e]">Starred but has no location set on GitHub</p>
          )}
          {findStatus === "not-found" && (
            <p className="text-[10px] text-[#f85149]">Not found in stargazers</p>
          )}
        </div>
      </div>

      {/* Legend — compare mode indicator only */}
      {compareOwner && compareRepo && (
        <div className="absolute bottom-6 right-4 z-10
          bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg px-3 py-2
          text-[11px] backdrop-blur-md select-none flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[#a371f7] flex-shrink-0" />
          <span className="text-[#8b949e] text-[10px] truncate max-w-[120px]">{compareRepo}</span>
        </div>
      )}

      {/* Unmapped drawer */}
      {drawerOpen && (
        <div className="absolute bottom-0 left-0 right-0 z-20
          bg-[rgba(13,17,23,0.97)] border-t border-[#30363d] backdrop-blur-md
          flex flex-col max-h-[45vh]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#21262d] flex-shrink-0">
            <div>
              <span className="text-sm text-[#8b949e]">
                <strong className="text-[#f0f6fc]">{unmapped.length.toLocaleString()} stargazers</strong> without location
              </span>
              <span className="ml-2 text-[10px] text-[#484f58]">— no location set on their GitHub profile</span>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="text-[#8b949e] hover:text-[#f0f6fc] text-lg leading-none">✕</button>
          </div>
          <div className="overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[...unmapped].sort((a, b) => b.followers - a.followers).map((u) => (
              <div
                key={u.login}
                className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-r border-[#161b22] text-xs ${
                  u.followers >= 1000 ? "ring-inset ring-1 ring-[#ffa657]/20" : ""
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-[#21262d] flex-shrink-0 flex items-center justify-center text-[10px] text-[#484f58] font-medium overflow-hidden">
                  {u.login[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <a
                    href={`https://github.com/${u.login}`}
                    target="_blank"
                    className="text-[#58a6ff] font-medium hover:underline block truncate"
                  >
                    @{u.login}
                  </a>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {u.name && (
                      <span className="text-[#484f58] truncate text-[10px]">{u.name}</span>
                    )}
                    {u.followers >= 1000 && (
                      <span className="flex-shrink-0 text-[9px] text-[#ffa657] font-medium">⚡ {(u.followers / 1000).toFixed(1)}k</span>
                    )}
                    {u.followers > 0 && u.followers < 1000 && (
                      <span className="flex-shrink-0 text-[9px] text-[#484f58]">{u.followers.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Back link */}
      <a
        href="/"
        className="absolute top-4 left-4 z-10 bg-[rgba(13,17,23,0.88)] border border-[#30363d]
          rounded-lg px-3 py-2 text-xs text-[#8b949e] hover:text-[#f0f6fc] backdrop-blur-md transition-colors"
      >
        ← Back
      </a>

      {/* Bottom-left — vertical dock: follower filter + secondary actions + Share CTA */}
      {(stats || allStargazers.length > 0) && (
        <div className="absolute bottom-6 left-4 z-10 flex flex-col gap-2">

          {/* Follower tier filter */}
          <div className="bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg px-3 py-2 backdrop-blur-md flex flex-col gap-1">
            <span className="text-[10px] text-[#484f58] uppercase tracking-widest mb-0.5">Filter map</span>
            {([
              { key: "all", label: "All", dot: null },
              { key: "high", label: "500+ followers", dot: "bg-[#f85149]" },
              { key: "mid", label: "100–500", dot: "bg-[#ffa657]" },
              { key: "low", label: "<100", dot: "bg-[#58a6ff]" },
            ] as const).map(({ key, label, dot }) => {
              const active = followerMapFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFollowerMapFilter(active && key !== "all" ? "all" : key)}
                  className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs transition-colors text-left ${
                    active ? "bg-[#21262d] text-[#f0f6fc]" : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#f0f6fc]"
                  }`}
                >
                  {dot
                    ? <span className={`inline-block w-2 h-2 rounded-full ${dot} flex-shrink-0`} />
                    : <span className="inline-block w-2 h-2 flex-shrink-0" />
                  }
                  {label}
                </button>
              );
            })}
          </div>
          {stats && (
            <button
              onClick={() => setStatsOpen(true)}
              className="bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg
                px-3 py-2.5 text-xs text-[#8b949e] hover:text-[#f0f6fc]
                hover:border-[#58a6ff]/50 backdrop-blur-md transition-all flex items-center gap-2"
              title="Stargazer stats"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-[#58a6ff] flex-shrink-0" aria-hidden="true">
                <path d="M1.5 1.75a.75.75 0 00-1.5 0v12.5c0 .414.336.75.75.75h14.5a.75.75 0 000-1.5H1.5V1.75zm13.28 4.47a.75.75 0 00-1.06-1.06L10 8.94 7.53 6.47a.75.75 0 00-1.06 0L3.22 9.72a.75.75 0 001.06 1.06L7 8.06l2.47 2.47a.75.75 0 001.06 0l4.25-4.32z"/>
              </svg>
              <span>Stats</span>
            </button>
          )}
          {allStargazers.length > 0 && (
            <button
              onClick={() => setAllOpen(true)}
              className="bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg
                px-3 py-2.5 text-xs text-[#8b949e] hover:text-[#f0f6fc]
                hover:border-[#a371f7]/50 backdrop-blur-md transition-all flex items-center gap-2"
              title="All stargazers"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-[#a371f7] flex-shrink-0" aria-hidden="true">
                <path d="M2 5.5a3.5 3.5 0 115.898 2.549 5.508 5.508 0 013.034 4.084.75.75 0 11-1.482.235 4 4 0 00-7.9 0 .75.75 0 01-1.482-.236A5.507 5.507 0 013.102 8.05 3.493 3.493 0 012 5.5zM11 4a3 3 0 102.22 5.018 5.01 5.01 0 012.56 3.012.75.75 0 11-1.45.39 3.504 3.504 0 00-6.66 0 .75.75 0 11-1.45-.39A5.01 5.01 0 018.78 9.018 3 3 0 0111 4z"/>
              </svg>
              <span>Stargazers</span>
              <span className="bg-[#30363d] text-[#8b949e] text-[10px] px-1.5 py-px rounded-full tabular-nums leading-none ml-auto">
                {allStargazers.length.toLocaleString()}
              </span>
            </button>
          )}
          {growthData.length > 0 && (
            <button
              onClick={() => setGrowthOpen(true)}
              className="bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg
                px-3 py-2.5 text-xs text-[#8b949e] hover:text-[#f0f6fc]
                hover:border-[#3fb950]/50 backdrop-blur-md transition-all flex items-center gap-2"
              title="Star growth chart"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#3fb950] flex-shrink-0" aria-hidden="true">
                <path d="M1.5 12.5 5 8l3 3 3.5-5 3 3"/>
              </svg>
              <span>Growth</span>
            </button>
          )}
          <a
            href={`https://star-history.com/#${owner}/${repo}&type=Date`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[rgba(13,17,23,0.88)] border border-[#30363d] rounded-lg
              px-3 py-2.5 text-xs text-[#8b949e] hover:text-[#f0f6fc]
              hover:border-[#ffa657]/50 backdrop-blur-md transition-all flex items-center gap-2"
            title="View star history on star-history.com"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-[#ffa657] flex-shrink-0" aria-hidden="true">
              <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
            </svg>
            <span>History</span>
          </a>

          {/* Share CTA */}
          <button
            onClick={() => setShareOpen(true)}
            className="bg-[#238636] hover:bg-[#2ea043] active:bg-[#1a7f2e]
              border border-[#2ea043]/60 hover:border-[#3fb950]/60
              rounded-lg px-3 py-2.5
              text-white text-xs font-semibold
              backdrop-blur-md transition-all duration-150
              flex items-center gap-2 w-full
              shadow-[0_0_12px_rgba(35,134,54,0.3)] hover:shadow-[0_0_20px_rgba(46,160,67,0.45)]"
            aria-label="Share this stargazer map"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0" aria-hidden="true">
              <path d="M2.75 3.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 010 1.5h-2A1.75 1.75 0 011 11.25v-7.5C1 2.784 1.784 2 2.75 2h2.5a.75.75 0 010 1.5h-2.5zm10.5 0a.75.75 0 010-1.5h-4.5a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0V4.56L13.47 8l-3.97 3.44V9.75a.75.75 0 00-1.5 0v3.5c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-2.5z"/>
            </svg>
            Share
          </button>
        </div>
      )}

      {/* Stargazers table modal */}
      {allOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(13,17,23,0.85)] backdrop-blur-sm"
          onClick={() => setAllOpen(false)}
        >
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d] flex-shrink-0">
              <h2 className="text-[#f0f6fc] font-semibold text-sm">
                All Stargazers
                <span className="text-[#8b949e] font-normal ml-2">
                  {filteredStargazers.length !== allStargazers.length
                    ? `${filteredStargazers.length} / ${allStargazers.length.toLocaleString()}`
                    : allStargazers.length.toLocaleString()}
                </span>
              </h2>
              <button onClick={() => setAllOpen(false)} className="text-[#8b949e] hover:text-[#f0f6fc] text-lg leading-none">✕</button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-[#21262d] flex-shrink-0">
              <input
                autoFocus
                value={allSearch}
                onChange={(e) => setAllSearch(e.target.value)}
                placeholder="Search by username, name or location…"
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
              />
            </div>

            {/* Filters */}
            <div className="px-5 py-2.5 border-b border-[#21262d] flex-shrink-0 flex flex-wrap items-center gap-3">
              {/* Followers filter */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-[#8b949e] whitespace-nowrap">Min followers</span>
                <div className="flex gap-1">
                  {[0, 10, 100, 500, 1000].map((v) => (
                    <button
                      key={v}
                      onClick={() => setFilterFollowers(v)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        filterFollowers === v
                          ? "bg-[#58a6ff] text-white"
                          : "bg-[#21262d] text-[#8b949e] hover:text-[#f0f6fc]"
                      }`}
                    >
                      {v === 0 ? "All" : v >= 1000 ? `${v / 1000}k+` : `${v}+`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-3 w-px bg-[#30363d] hidden sm:block" />

              {/* Mapped filter */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#8b949e] whitespace-nowrap">Location</span>
                <div className="flex gap-1">
                  {(["all", "mapped", "unmapped"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFilterMapped(v)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        filterMapped === v
                          ? "bg-[#58a6ff] text-white"
                          : "bg-[#21262d] text-[#8b949e] hover:text-[#f0f6fc]"
                      }`}
                    >
                      {v === "all" ? "All" : v === "mapped" ? "📍 On map" : "No location"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-3 w-px bg-[#30363d] hidden sm:block" />

              {/* Date filter */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#8b949e] whitespace-nowrap">Starred</span>
                <div className="flex gap-1">
                  {(["all", "30d", "90d", "1y"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFilterDate(v)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        filterDate === v ? "bg-[#58a6ff] text-white" : "bg-[#21262d] text-[#8b949e] hover:text-[#f0f6fc]"
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
                onChange={(e) => setFilterCompany(e.target.value)}
                placeholder="Company…"
                className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-0.5 text-[10px] text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] w-24"
              />

              {/* Country filter */}
              <FilterCombobox
                value={filterCountry}
                onChange={setFilterCountry}
                options={countryOptions}
                placeholder="Country…"
              />

              {/* City filter */}
              <FilterCombobox
                value={filterCity}
                onChange={setFilterCity}
                options={cityOptions}
                placeholder="City…"
              />

              {/* Active filters count + reset */}
              {(filterFollowers > 0 || filterMapped !== "all" || filterDate !== "all" || filterCompany || filterCountry || filterCity) && (
                <button
                  onClick={() => { setFilterFollowers(0); setFilterMapped("all"); setFilterDate("all"); setFilterCompany(""); setFilterCountry(""); setFilterCity(""); }}
                  className="ml-auto text-[10px] text-[#484f58] hover:text-[#8b949e] transition-colors"
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
                <div className="sticky top-0 left-0 right-0 z-20 flex items-center justify-center py-1 bg-[#161b22]/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-[10px] text-[#484f58]">
                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Filtering…
                  </div>
                </div>
              )}
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[#161b22] z-10">
                  <tr className="border-b border-[#21262d]">
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === filteredStargazers.length}
                        ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filteredStargazers.length; }}
                        onChange={toggleAll}
                        className="accent-[#58a6ff] cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium w-6 text-right">#</th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium">
                      <button onClick={() => toggleSort("login")} className="flex items-center gap-1 hover:text-[#f0f6fc]">
                        User {allSort.key === "login" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right text-[#8b949e] font-medium">
                      <button onClick={() => toggleSort("followers")} className="flex items-center gap-1 hover:text-[#f0f6fc] ml-auto">
                        {allSort.key === "followers" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>} Followers
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium hidden sm:table-cell">
                      <button onClick={() => toggleSort("location")} className="flex items-center gap-1 hover:text-[#f0f6fc]">
                        Location {allSort.key === "location" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium hidden md:table-cell">
                      <button onClick={() => toggleSort("starredAt")} className="flex items-center gap-1 hover:text-[#f0f6fc]">
                        Starred {allSort.key === "starredAt" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium hidden lg:table-cell">
                      <button onClick={() => toggleSort("company")} className="flex items-center gap-1 hover:text-[#f0f6fc]">
                        Company {allSort.key === "company" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left text-[#8b949e] font-medium hidden xl:table-cell">Links</th>
                    <th className="px-3 py-2.5 w-8"></th>
                    <th className="px-4 py-2.5 text-center text-[#8b949e] font-medium">Map</th>
                  </tr>
                </thead>
                <tbody>
                  {tablePadTop > 0 && <tr style={{ height: tablePadTop }}><td colSpan={10} style={{ padding: 0 }} /></tr>}
                  {tableSlice.map((u, _i) => {
                    const i = tableVStart + _i;
                    return (
                    <tr
                      key={u.login}
                      onClick={() => toggleRow(u.login)}
                      className={`border-b border-[#161b22] cursor-pointer transition-colors ${
                        selected.has(u.login) ? "bg-[#1c2128]" : "hover:bg-[#0d1117]"
                      }`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(u.login)}
                          onChange={() => toggleRow(u.login)}
                          className="accent-[#58a6ff] cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-[#484f58] text-right">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {u.avatarUrl
                            ? <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                            : <div className="w-6 h-6 rounded-full bg-[#21262d] flex-shrink-0" />
                          }
                          <div className="min-w-0">
                            <a
                              href={`https://github.com/${u.login}`}
                              target="_blank"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[#58a6ff] font-medium hover:underline"
                            >
                              @{u.login}
                            </a>
                            {u.name && u.name !== u.login && (
                              <div className="text-[#8b949e] text-[10px] truncate max-w-[140px]">{u.name}</div>
                            )}
                            {u.bio && (
                              <div className="text-[#484f58] text-[10px] truncate max-w-[140px]" title={u.bio}>{u.bio}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-[#8b949e] tabular-nums">
                        {u.followers > 0 ? u.followers.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-[#8b949e] max-w-[160px] hidden sm:table-cell">
                        <span className="truncate block">{u.location ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-[#484f58] hidden md:table-cell tabular-nums">
                        {u.starredAt ? new Date(u.starredAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-[#484f58] hidden lg:table-cell">
                        <span className="truncate block max-w-[120px]">{u.company ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          {u.email && (
                            <a href={`mailto:${u.email}`} title={u.email} className="text-[#8b949e] hover:text-[#58a6ff] transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-8.5A1.75 1.75 0 0 0 14.25 2Zm0 1.5h12.5a.25.25 0 0 1 .25.25v.852l-6.36 3.682a.25.25 0 0 1-.254 0L1.5 4.602V3.75a.25.25 0 0 1 .25-.25Zm-.25 2.68 5.86 3.393a1.75 1.75 0 0 0 1.78 0L15 6.18v6.07a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25Z"/></svg>
                            </a>
                          )}
                          {u.blog && (
                            <a href={u.blog.startsWith("http") ? u.blog : `https://${u.blog}`} title={u.blog} className="text-[#8b949e] hover:text-[#58a6ff] transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/></svg>
                            </a>
                          )}
                          {u.twitter_username && (
                            <a href={`https://x.com/${u.twitter_username}`} title={`@${u.twitter_username}`} className="text-[#8b949e] hover:text-[#58a6ff] transition-colors" target="_blank" rel="noopener noreferrer">
                              <svg width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                            </a>
                          )}
                          {!u.email && !u.blog && !u.twitter_username && (
                            <span className="text-[#30363d] text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${u.mapped ? "bg-[#3fb950]" : "bg-[#30363d]"}`} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        {u.mapped && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const pt = points.find((p) => p.login === u.login);
                              if (pt) { setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login }); setAllOpen(false); }
                            }}
                            title="Fly to on map"
                            className="text-[#484f58] hover:text-[#58a6ff] transition-colors text-xs"
                          >
                            🗺
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
                <div className="text-center text-[#484f58] text-xs py-12">No results for &ldquo;{allSearch}&rdquo;</div>
              )}
            </div>

            {/* Selection action bar */}
            {selected.size > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-[#21262d] bg-[#0d1117] rounded-b-2xl flex-shrink-0">
                <span className="text-xs text-[#8b949e]">
                  <strong className="text-[#f0f6fc]">{selected.size}</strong> selected
                  <button onClick={() => setSelected(new Set())} className="ml-3 text-[#484f58] hover:text-[#8b949e]">✕ Clear</button>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText([...selected].join("\n"))}
                    className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
                  >
                    Copy logins
                  </button>
                  <button
                    onClick={() => exportCsv(allStargazers.filter((u) => selected.has(u.login)))}
                    className="bg-[#21262d] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#f0f6fc] transition-colors"
                  >
                    ↓ Export CSV
                  </button>
                  <button
                    onClick={fetchAndExport}
                    disabled={fetching}
                    className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 rounded-lg px-3 py-1.5 text-xs text-white font-medium transition-colors"
                  >
                    {fetching ? "Fetching…" : `↓ Fetch details + CSV (${selected.size})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Growth chart modal */}
      {growthOpen && growthData.length > 0 && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(13,17,23,0.85)] backdrop-blur-sm"
          onClick={() => setGrowthOpen(false)}
        >
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl w-full max-w-2xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d]">
              <div>
                <h2 className="text-[#f0f6fc] font-semibold text-sm">Star Growth</h2>
                <p className="text-[#8b949e] text-[10px] mt-0.5">{growthData.length} weeks · {(points.length + unmapped.length).toLocaleString()} total stars</p>
              </div>
              <button onClick={() => setGrowthOpen(false)} className="text-[#8b949e] hover:text-[#f0f6fc] text-lg leading-none">✕</button>
            </div>
            <div className="px-5 py-5">
              <GrowthChart data={growthData} />
            </div>
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareOpen && repoInfo && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(13,17,23,0.85)] backdrop-blur-sm"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d]">
              <h2 className="text-[#f0f6fc] font-semibold text-sm">Share</h2>
              <button onClick={() => setShareOpen(false)} className="text-[#8b949e] hover:text-white text-xl leading-none">×</button>
            </div>

            {/* Preview card */}
            <div id="share-card" className="mx-5 my-4 bg-[#0d1117] rounded-xl p-6 border border-[#30363d]">
              <div className="flex items-center gap-3 mb-4">
                {repoInfo.avatar && <img src={repoInfo.avatar} className="w-10 h-10 rounded-full border border-[#30363d] flex-shrink-0" alt="" />}
                <div className="min-w-0">
                  <div className="text-[#8b949e] text-xs leading-tight">{owner}</div>
                  <div className="text-[#f0f6fc] font-bold text-base leading-tight truncate">{repo}</div>
                  {repoInfo.description && <div className="text-[#8b949e] text-xs mt-1 line-clamp-1">{repoInfo.description}</div>}
                </div>
              </div>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 bg-[#161b22] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[#ffa657]">{repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars}</div>
                  <div className="text-[10px] text-[#484f58] uppercase tracking-wide mt-0.5">★ stars</div>
                </div>
                <div className="flex-1 bg-[#161b22] rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-[#58a6ff]">{points.length.toLocaleString()}</div>
                  <div className="text-[10px] text-[#484f58] uppercase tracking-wide mt-0.5">mapped</div>
                </div>
                {stats && (
                  <div className="flex-1 bg-[#161b22] rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-[#3fb950]">{stats.countryCount}</div>
                    <div className="text-[10px] text-[#484f58] uppercase tracking-wide mt-0.5">countries</div>
                  </div>
                )}
              </div>
              {stats && stats.topCountries.slice(0, 3).length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {stats.topCountries.slice(0, 3).map(([country, count]) => (
                    <span key={country} className="text-xs bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[#8b949e]">
                      {country} · {count}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-[#21262d] flex items-center justify-between">
                <span className="text-[10px] text-[#484f58]">🌍 starmapper.bruniaux.com</span>
                <span className="text-[10px] text-[#484f58]">+ live map in download</span>
              </div>
            </div>

            <div className="px-5 pb-5 flex flex-col gap-3">
              <div className="flex gap-3">
              <button
                onClick={() => {
                  const url = window.location.href;
                  navigator.clipboard.writeText(url).catch(() => {});
                }}
                className="flex-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] text-sm py-2 rounded-lg transition-colors"
              >
                Copy link
              </button>
              <button
                onClick={async () => {
                  const dataUrl = await captureMapRef.current?.();
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
                  const tagsH = stats?.topCountries.length ? Math.round(34 * S) : 0;
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
                    { v: stats?.countryCount ?? 0, label: "COUNTRIES", color: "#3fb950" },
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
                  if (stats?.topCountries.length) {
                    const tagsY = statsY + boxH + Math.round(8 * S);
                    let tagX = panelX + pad;
                    const tSize = Math.round(9 * S);
                    ctx.font = `${tSize}px -apple-system, sans-serif`;
                    for (const [country, count] of stats.topCountries.slice(0, 3)) {
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
                className="flex-1 bg-[#238636] hover:bg-[#2ea043] text-white text-sm py-2 rounded-lg transition-colors font-medium"
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
                  className="flex-1 flex items-center justify-center gap-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] text-xs py-2 rounded-lg transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                  Share on X
                </a>
                <button
                  onClick={() => {
                    const starsLabel = repoInfo.stars >= 1000 ? `${(repoInfo.stars / 1000).toFixed(1)}k` : repoInfo.stars;
                    setLiDraft(`🌍 ${repo} just hit ${starsLabel} ⭐ — with stargazers from ${stats?.countryCount ?? "?"} countries!\n\n${window.location.href}`);
                    setLiCopied(false);
                    setLiPanelOpen(true);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] text-xs py-2 rounded-lg transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  Share on LinkedIn
                </button>

                {/* LinkedIn pre-share panel */}
                {liPanelOpen && (
                  <div className="absolute inset-0 z-10 rounded-xl bg-[#0d1117] border border-[#30363d] flex flex-col p-4 gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#f0f6fc]">Your LinkedIn post</span>
                      <button onClick={() => setLiPanelOpen(false)} className="text-[#8b949e] hover:text-white text-lg leading-none">×</button>
                    </div>
                    <textarea
                      value={liDraft}
                      onChange={(e) => setLiDraft(e.target.value)}
                      rows={5}
                      className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-[#e6edf3] resize-none focus:outline-none focus:border-[#58a6ff]"
                    />
                    <p className="text-[10px] text-[#484f58]">LinkedIn doesn&apos;t allow pre-filled text. Copy this post, then paste it after clicking below.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(liDraft).catch(() => {});
                          setLiCopied(true);
                          setTimeout(() => setLiCopied(false), 3000);
                        }}
                        className="flex-1 bg-[#21262d] border border-[#30363d] text-xs py-2 rounded-lg transition-colors hover:bg-[#30363d]"
                        style={{ color: liCopied ? "#3fb950" : "#8b949e" }}
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
              <button
                onClick={() => {
                  const origin = window.location.origin;
                  const md = `[![StarMapper](${origin}/api/badge/${owner}/${repo})](${origin}/${owner}/${repo})`;
                  navigator.clipboard.writeText(md).catch(() => {});
                }}
                className="w-full flex items-center justify-center gap-2 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] text-xs py-2 rounded-lg transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                Copy README badge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats modal */}
      {statsOpen && stats && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(13,17,23,0.85)] backdrop-blur-sm"
          onClick={() => setStatsOpen(false)}
        >
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262d] flex-shrink-0">
              <h2 className="text-[#f0f6fc] font-semibold text-sm">Stargazer Stats</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const md = [
                      `# StarMapper — ${owner}/${repo}`,
                      ``,
                      `- **Total stargazers**: ${(points.length + unmapped.length).toLocaleString()} (${stats.mappingRate}% mapped)`,
                      `- **Countries**: ${stats.countryCount}`,
                      `- **Cities**: ${stats.topCities.length}`,
                      `- **Avg followers**: ${stats.avgFollowers.toLocaleString()}`,
                      ``,
                      `## Top Countries`,
                      ...stats.topCountries.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`),
                      ``,
                      `## Top Cities`,
                      ...stats.topCities.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`),
                      `## Top Companies`,
                      ...(stats.topCompanies.length ? stats.topCompanies.slice(0, 10).map(([c, n], i) => `${i + 1}. ${c} — ${n}`) : ["No company data"]),
                      ``,
                      `## Top Stargazers`,
                      ...stats.topUsers.slice(0, 10).map((u, i) => `${i + 1}. [@${u.login}](https://github.com/${u.login}) — ${u.followers.toLocaleString()} followers`),
                      ``,
                      `*Generated by [StarMapper](https://starmapper.app)*`,
                    ].join("\n");
                    navigator.clipboard.writeText(md).catch(() => {});
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-[#8b949e] hover:text-[#f0f6fc] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg px-2.5 py-1 transition-colors"
                  title="Copy stats as Markdown"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
                  </svg>
                  Copy MD
                </button>
                <button onClick={() => setStatsOpen(false)} className="text-[#8b949e] hover:text-[#f0f6fc] text-lg leading-none">✕</button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-2 px-5 py-4 border-b border-[#21262d] flex-shrink-0">
              <div className="bg-[#0d1117] rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-[#3fb950]">{stats.mappingRate}%</div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">mapped</div>
              </div>
              <div className="bg-[#0d1117] rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-[#f0f6fc]">{stats.countryCount}</div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">countries</div>
              </div>
              <div className="bg-[#0d1117] rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-[#f0f6fc]">{stats.topCities.length}</div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">cities</div>
              </div>
              <div className="bg-[#0d1117] rounded-lg px-2 py-2 text-center">
                <div className="text-xl font-bold text-[#ffa657]">
                  {stats.avgFollowers >= 1000 ? `${(stats.avgFollowers / 1000).toFixed(1)}k` : stats.avgFollowers}
                </div>
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">avg flw</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#21262d] flex-shrink-0">
              {(["top", "countries", "cities", "companies"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setStatsTab(tab); setStatsFilter(""); }}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    statsTab === tab
                      ? "text-[#58a6ff] border-b-2 border-[#58a6ff] -mb-px"
                      : "text-[#8b949e] hover:text-[#f0f6fc]"
                  }`}
                >
                  {tab === "top" ? "Top Stars" : tab === "countries" ? "Countries" : tab === "cities" ? "Cities" : "🏢 Companies"}
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
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-xs text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff]"
                />
              </div>
            )}

            {/* List */}
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {statsTab === "top" && (
                <div className="space-y-2.5">
                  {stats.topUsers.map((u, i) => (
                    <div key={u.login} className="flex items-center gap-3 py-0.5">
                      <span className="text-[#484f58] text-xs w-5 text-right flex-shrink-0">{i + 1}</span>
                      {u.avatarUrl
                        ? <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-[#30363d]" />
                        : <div className="w-8 h-8 rounded-full bg-[#21262d] flex-shrink-0 ring-1 ring-[#30363d]" />
                      }
                      <div className="flex-1 min-w-0">
                        <a
                          href={`https://github.com/${u.login}`}
                          target="_blank"
                          className="text-[#58a6ff] text-xs font-medium hover:underline"
                        >
                          @{u.login}
                        </a>
                        {u.location && (
                          <div className="text-[#484f58] text-[10px] truncate">{u.location}</div>
                        )}
                      </div>
                      <span className="text-[#8b949e] text-xs flex-shrink-0 tabular-nums">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="#8b949e" className="inline mr-1 mb-0.5"><path d="M3 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm3 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM1.5 3A1.5 1.5 0 0 0 0 4.5v7A1.5 1.5 0 0 0 1.5 13h13a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 14.5 3Z"/></svg>
                        {u.followers.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {statsTab === "countries" && (
                <StatsList
                  items={stats.topCountries.filter(([name]) => !statsFilter || name.toLowerCase().includes(statsFilter.toLowerCase()))}
                  max={stats.topCountries[0]?.[1] ?? 1}
                />
              )}
              {statsTab === "cities" && (
                <StatsList
                  items={stats.topCities.filter(([name]) => !statsFilter || name.toLowerCase().includes(statsFilter.toLowerCase()))}
                  max={stats.topCities[0]?.[1] ?? 1}
                />
              )}
              {statsTab === "companies" && (
                <div className="space-y-2">
                  {stats.topCompanies
                    .filter(([company]) => !statsFilter || company.toLowerCase().includes(statsFilter.toLowerCase()))
                    .map(([company, count], idx) => (
                    <div key={company} className="flex items-center gap-3">
                      <div className="text-[#484f58] text-xs w-4 text-right flex-shrink-0">{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[#e6edf3] text-xs truncate">{company}</span>
                          <span className="text-[#8b949e] text-xs ml-2 flex-shrink-0">{count}</span>
                        </div>
                        <div className="h-1 bg-[#21262d] rounded-full">
                          <div className="h-1 bg-[#58a6ff] rounded-full" style={{ width: `${(count / (stats.topCompanies[0]?.[1] ?? 1)) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {stats.topCompanies.length === 0 && (
                    <div className="text-center text-[#484f58] text-xs py-8">No company data available</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const StatsList = ({ items, max }: { items: [string, number][]; max: number }) => (
  <div className="space-y-2">
    {items.map(([name, count]) => (
      <div key={name} className="flex items-center gap-3">
        <div className="text-[#e6edf3] text-xs w-36 truncate flex-shrink-0">{name}</div>
        <div className="flex-1 bg-[#21262d] rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-[#58a6ff] h-full rounded-full"
            style={{ width: `${(count / max) * 100}%` }}
          />
        </div>
        <span className="text-[#8b949e] text-xs w-8 text-right flex-shrink-0">{count}</span>
      </div>
    ))}
  </div>
);

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
        <div className="bg-[#0d1117] rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-[#f0f6fc]">{total.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">total stars</div>
        </div>
        <div className="bg-[#0d1117] rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-[#58a6ff]">{peak[1].toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">best week</div>
        </div>
        <div className="bg-[#0d1117] rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-[#ffa657]">{avg.toLocaleString()}</div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wide mt-0.5">avg / week</div>
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
          stroke="#ffa657" strokeWidth={1} strokeDasharray="5,4" opacity={0.5}
        />
        <text x={W - 2} y={avgY - 3} fontSize={7} fill="#ffa657" textAnchor="end" opacity={0.7}>avg</text>

        {data.map(([date, count], i) => {
          const barH = Math.max(2, (count / max) * H);
          const x = i * (barW + gap);
          const isPeak = date === peak[0];
          const isHovered = i === hoveredIdx;
          return (
            <g key={date}>
              <rect
                x={x} y={H - barH} width={barW} height={barH}
                fill={isPeak ? "#ffa657" : "#58a6ff"}
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
                <text x={x} y={H + 14} fontSize={8} fill="#484f58" textAnchor="middle" dx={barW / 2}>
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
              rx={4} fill="#21262d" stroke="#30363d" strokeWidth={1}
            />
            <text x={tooltipX + 8} y={Math.max(14, tooltipY + 12)} fontSize={8} fill="#8b949e">
              {hoveredItem[0].slice(5)}
            </text>
            <text x={tooltipX + 8} y={Math.max(26, tooltipY + 24)} fontSize={9} fill="#f0f6fc" fontWeight="bold">
              {hoveredItem[1].toLocaleString()} stars
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
