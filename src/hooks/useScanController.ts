// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";
import { getStoredToken } from "@/components/token-modal";
import { setStoredToken } from "@/lib/token";
import { saveBookmark } from "@/lib/bookmarks";
import { clearCache, saveCache } from "@/lib/repo-cache";
import { compressToBase64 } from "@/lib/compress-client";
import { isCountry, normalizeCountry } from "@/lib/countries";

// Exported so page.tsx can set up the useReducer and pass dispatch/scanRef to this hook.
export type UnmappedEntry = { login: string; name: string | null; followers: number; starredAt: string | null };

export type ScanState = {
  points: StargazerPoint[];
  unmapped: UnmappedEntry[];
  processed: number;
};

export type ScanAction =
  | { type: "reset" }
  | { type: "set"; points: StargazerPoint[]; unmapped: UnmappedEntry[] }
  | { type: "chunk"; points: StargazerPoint[]; unmapped: UnmappedEntry[] };

export const scanReducer = (state: ScanState, action: ScanAction): ScanState => {
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

class RateLimitedError extends Error {
  resetAt: number;
  reason: "github" | "server";
  constructor(resetAt: number, reason: "github" | "server" = "server") {
    super("rate_limited");
    this.resetAt = resetAt;
    this.reason = reason;
  }
}

class TokenInvalidError extends Error {
  constructor() {
    super("token_invalid");
  }
}

export type ScanStatus = "idle" | "loading" | "waiting" | "done" | "cached" | "refreshing" | "error";

type RepoInfoSlim = { language: string | null; forksCount?: number; watchersCount?: number } | null;

type ScanControllerOptions = {
  owner: string;
  repo: string;
  dispatch: React.Dispatch<ScanAction>;
  scanRef: React.RefObject<ScanState>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setCachedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setLatestStarredAt: React.Dispatch<React.SetStateAction<string | null>>;
  setTokenOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHasToken: React.Dispatch<React.SetStateAction<boolean>>;
  setServerStats: React.Dispatch<React.SetStateAction<RepoStats | null>>;
  ghHeaders: () => Record<string, string>;
  repoInfo: RepoInfoSlim;
  total: number;
  latestStarredAt: string | null;
};

export const useScanController = ({
  owner, repo, dispatch, scanRef,
  setTotal, setCachedAt, setLatestStarredAt,
  setTokenOpen, setHasToken, setServerStats,
  ghHeaders, repoInfo, total, latestStarredAt,
}: ScanControllerOptions) => {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [retryIn, setRetryIn] = useState(0);
  const [retryTotal, setRetryTotal] = useState(0);
  const [waitReason, setWaitReason] = useState<"github" | "server">("server");
  const [error, setError] = useState("");
  const [tokenFallback, setTokenFallback] = useState(false);
  const runningRef = useRef(false);
  const pendingScanRef = useRef(false);
  const pendingRefreshRef = useRef(false);

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
      throw new RateLimitedError(body.resetAt ?? Date.now() + 60_000, body.resetAt ? "github" : "server");
    }
    if (res.status === 401) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (body.error === "github_token_invalid") throw new TokenInvalidError();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ChunkResponse;
  }, [owner, repo, ghHeaders]);

  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    clearCache(owner, repo);
    dispatch({ type: "reset" });
    setStatus("loading");
    let cursor: string | null = null;
    let allPoints: StargazerPoint[] = [];
    let allUnmapped: UnmappedEntry[] = [];
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
            } else if (e instanceof TokenInvalidError) {
              // PAT expired or revoked — clear it and retry with server token
              setStoredToken("");
              setHasToken(false);
              setTokenFallback(true);
            } else {
              throw e;
            }
          }
        }

        if (!newestStarredAt && chunk!.latestStarredAt) newestStarredAt = chunk!.latestStarredAt;
        setTotal(chunk!.totalCount);
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

      // Save to DB cache first (shared across users), then update badge cache.
      // Order matters: badge-update fires only after stargazer-cache succeeds so we never
      // create a badge_cache entry without its corresponding stargazer_cache (ghost repo).
      // Compress client-side to stay under Vercel's 4.5MB request body limit.
      const finalTotal = allPoints.length + allUnmapped.length;
      const countrySet = new Set(
        allPoints
          .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
          .filter(Boolean),
      );
      if (finalTotal > 0) {
        (async () => {
          try {
            type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
            const slim: SlimPoint[] = allPoints.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
            const [pointsGz, unmappedGz] = await Promise.all([
              compressToBase64(slim),
              compressToBase64(allUnmapped),
            ]);
            const cacheHeaders: Record<string, string> = { "Content-Type": "application/json" };
            const storedToken = getStoredToken();
            if (storedToken) cacheHeaders["x-gh-token"] = storedToken;
            const cacheRes = await fetch("/api/stargazer-cache", {
              method: "POST",
              headers: cacheHeaders,
              body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount: finalTotal, latestStarredAt: newestStarredAt, ts: Date.now() }),
            });
            if (!cacheRes.ok) return;
            // badge-update only if scan cache was persisted — prevents ghost repos
            fetch("/api/badge-update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                owner,
                repo,
                mappedCount: allPoints.length,
                countryCount: countrySet.size,
                totalCount: finalTotal,
                language: repoInfo?.language ?? null,
                ...(repoInfo?.forksCount !== undefined && { forksCount: repoInfo.forksCount }),
                ...(repoInfo?.watchersCount !== undefined && { watchersCount: repoInfo.watchersCount }),
              }),
            })
              .then(() => fetch(`/api/stats/${owner}/${repo}`))
              .then((r) => r.ok ? r.json() : null)
              .then((data) => { if (data) setServerStats(data as RepoStats); })
              .catch(() => {});
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
  // repoInfo fields used in fire-and-forget badge-update at scan end — stale closure
  // is harmless (defensive ?. guards, repoInfo loads before any scan completes).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNextChunk, owner, repo]);

  const startRefresh = useCallback(async () => {
    if (runningRef.current || !latestStarredAt) return;
    runningRef.current = true;
    setStatus("refreshing");
    let cursor: string | null = null;
    const newPoints: StargazerPoint[] = [];
    const newUnmapped: UnmappedEntry[] = [];
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
            } else if (e instanceof TokenInvalidError) {
              setStoredToken("");
              setHasToken(false);
              setTokenFallback(true);
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
        const countrySet = new Set(
          mergedPoints
            .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
            .filter(Boolean),
        );
        (async () => {
          try {
            type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
            const slim: SlimPoint[] = mergedPoints.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
            const [pointsGz, unmappedGz] = await Promise.all([
              compressToBase64(slim),
              compressToBase64(mergedUnmapped),
            ]);
            const cacheRes = await fetch("/api/stargazer-cache", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount: latestTotalCount, latestStarredAt: updatedLatest, ts: now }),
            });
            if (!cacheRes.ok) return;
            fetch("/api/badge-update", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                owner,
                repo,
                mappedCount: mergedPoints.length,
                countryCount: countrySet.size,
                totalCount: latestTotalCount,
                language: repoInfo?.language ?? null,
                ...(repoInfo?.forksCount !== undefined && { forksCount: repoInfo.forksCount }),
                ...(repoInfo?.watchersCount !== undefined && { watchersCount: repoInfo.watchersCount }),
              }),
            })
              .then(() => fetch(`/api/stats/${owner}/${repo}`))
              .then((r) => r.ok ? r.json() : null)
              .then((data) => { if (data) setServerStats(data as RepoStats); })
              .catch(() => {});
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
  }, [fetchNextChunk, latestStarredAt, owner, repo, total, dispatch, scanRef, setCachedAt, setLatestStarredAt, setTotal]);

  const handleStartScan = useCallback(() => {
    if (!getStoredToken()) {
      pendingScanRef.current = true;
      setTokenOpen(true);
      return;
    }
    startScraping();
  }, [startScraping, setTokenOpen]);

  const handleStartRefresh = useCallback(() => {
    if (!getStoredToken()) {
      pendingRefreshRef.current = true;
      setTokenOpen(true);
      return;
    }
    startRefresh();
  }, [startRefresh, setTokenOpen]);

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
  }, [startScraping, startRefresh, setTokenOpen, setHasToken]);

  return {
    status, setStatus,
    retryIn, retryTotal, waitReason, error,
    tokenFallback,
    startScraping, startRefresh,
    handleStartScan, handleStartRefresh, handleTokenClose,
    runningRef,
  };
};
