// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useEffect, useRef, useState } from "react";
import { loadCache, saveCache, clearCache } from "@/lib/repo-cache";
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
  /** Current GitHub stars count — used to detect stale caches (e.g. after fake-star removal). */
  currentStars?: number;
  dispatch: React.Dispatch<ScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setCachedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setLatestStarredAt: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<ScanStatus>>;
  /** Passed in so useScanController can also write serverStats after a fresh scan. */
  setServerStats?: React.Dispatch<React.SetStateAction<RepoStats | null>>;
};

type Result = {
  cacheCheckDone: boolean;
  lastDbScan: string | null;
  dataSource: "cache" | "reconstructed" | "engaged" | null;
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

// A cache whose totalCount exceeds current GitHub stars by this factor is considered
// stale (e.g. fake-star removal or significant unstar wave) and is discarded.
const STALE_CACHE_FACTOR = 1.15;

export const useRepoCacheLoader = ({
  owner, repo, repoInfo, currentStars, dispatch,
  setTotal, setCachedAt, setLatestStarredAt, setStatus,
  setServerStats: externalSetServerStats,
}: Options): Result => {
  const [cacheCheckDone, setCacheCheckDone] = useState(false);
  const [lastDbScan, setLastDbScan] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"cache" | "reconstructed" | "engaged" | null>(null);
  // Local state is used when no external setter is provided (e.g. in tests).
  const [_serverStats, _setServerStats] = useState<RepoStats | null>(null);
  const setServerStats = externalSetServerStats ?? _setServerStats;

  // Ref so the badge-sync effect can read latest repoInfo without re-triggering the main effect.
  const repoInfoRef = useRef(repoInfo);
  repoInfoRef.current = repoInfo;

  // Effect 1: load localStorage + revalidate against DB
  useEffect(() => {
    const MAX_LOCAL_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    const loaded = loadCache(owner, repo);
    const local = loaded && Date.now() - loaded.scannedAt <= MAX_LOCAL_AGE_MS ? loaded : null;
    if (loaded && !local) clearCache(owner, repo);

    // Discard local cache if its count is inflated vs. current GitHub stars (fake-star removal).
    const isLocalStale =
      local !== null &&
      currentStars !== undefined &&
      currentStars > 0 &&
      local.totalCount > currentStars * STALE_CACHE_FACTOR;
    if (isLocalStale) clearCache(owner, repo);

    const validLocal = isLocalStale ? null : local;
    if (validLocal) {
      dispatch({ type: "set", points: validLocal.points, unmapped: validLocal.unmapped });
      setTotal(validLocal.totalCount);
      setCachedAt(validLocal.scannedAt);
      setLatestStarredAt(validLocal.latestStarredAt ?? null);
      setStatus("cached");
      saveBookmark(owner, repo, validLocal.totalCount);
      setDataSource("cache");
      setCacheCheckDone(true);
    }

    const ac = new AbortController();

    // Degraded sources, tried in order of fidelity. Each fetch is caught independently — a
    // thrown exception (offline, DNS failure) on one source must not abort the chain before
    // the next source is tried. Returns true once a source has rendered a map.
    // Callers deliberately skip saveCache/saveBookmark/donate afterwards: degraded data must
    // never overwrite localStorage or the public badge counts.
    const tryDegradedSources = async (): Promise<boolean> => {
      let reconstructRes: Response | null = null;
      try {
        reconstructRes = await fetch(`/api/reconstruct/${owner}/${repo}`, { signal: ac.signal });
      } catch { /* try the next source */ }
      if (reconstructRes?.ok) {
        const rd = await reconstructRes.json();
        if (rd.points) {
          dispatch({ type: "set", points: rd.points, unmapped: rd.unmapped });
          setTotal(rd.totalCount);
          setStatus("cached");
          setDataSource("reconstructed");
          return true;
        }
      }
      let engagedRes: Response | null = null;
      try {
        engagedRes = await fetch(`/api/engaged/${owner}/${repo}`, { signal: ac.signal });
      } catch { /* give up silently, same as the outer catch */ }
      if (engagedRes?.ok) {
        const ed = await engagedRes.json();
        if (ed.points) {
          dispatch({ type: "set", points: ed.points, unmapped: ed.unmapped });
          setTotal(ed.knownCount);
          setStatus("cached");
          setDataSource("engaged");
          return true;
        }
      }
      return false;
    };

    (async () => {
      try {
        const r = await fetch(`/api/stargazer-cache/${owner}/${repo}`, { signal: ac.signal });
        if (r.status === 304) {
          // Server data unchanged since last fetch — local cache is already current.
          return;
        }
        if (r.status === 206) {
          const d = await r.json();
          if (validLocal) {
            donateLocalCacheToDb(owner, repo, validLocal);
            return;
          }
          // 206 means "scanned before, blob gone" — the profile most likely to still have
          // star_event rows, so try reconstruction before offering a fresh scan.
          if (await tryDegradedSources()) return;
          setLastDbScan(d.lastScan);
          return;
        }
        if (!r.ok) {
          if (validLocal) {
            donateLocalCacheToDb(owner, repo, validLocal);
            return;
          }
          await tryDegradedSources();
          return;
        }
        const data = await r.json();
        if (!data.points) return;
        const scannedMs = new Date(data.scannedAt).getTime();
        // Discard DB cache if its count is inflated vs. current GitHub stars.
        if (currentStars && currentStars > 0 && data.totalCount > currentStars * STALE_CACHE_FACTOR) return;
        // Skip update only if server data is both older AND has fewer/equal stars.
        // A higher totalCount on the server always wins (rescan captured more users).
        if (validLocal && scannedMs <= validLocal.scannedAt && data.totalCount <= validLocal.totalCount) return;
        dispatch({ type: "set", points: data.points, unmapped: data.unmapped });
        setTotal(data.totalCount);
        setCachedAt(scannedMs);
        setLatestStarredAt(data.latestStarredAt ?? null);
        setStatus("cached");
        setDataSource("cache");
        saveBookmark(owner, repo, data.totalCount);
        saveCache(owner, repo, {
          points: data.points,
          unmapped: data.unmapped,
          totalCount: data.totalCount,
          scannedAt: scannedMs,
          latestStarredAt: data.latestStarredAt ?? null,
        });
      } catch {
        // network errors + AbortError are silently ignored
      } finally {
        setCacheCheckDone(true);
      }
    })();
    return () => ac.abort();
  }, [owner, repo, currentStars, dispatch, setTotal, setCachedAt, setLatestStarredAt, setStatus]);

  // Effect 2: badge-sync — fires after localStorage hit, reads repoInfo via ref so it
  // doesn't re-run on every repoInfo update (forksCount/watchersCount are bonus fields).
  useEffect(() => {
    const MAX_LOCAL_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const loaded = loadCache(owner, repo);
    const local = loaded && Date.now() - loaded.scannedAt <= MAX_LOCAL_AGE_MS ? loaded : null;
    const isStale =
      local !== null &&
      currentStars !== undefined &&
      currentStars > 0 &&
      local.totalCount > currentStars * STALE_CACHE_FACTOR;
    if (!local || isStale) return;
    const countrySet = new Set(
      local.points
        .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
        .filter(Boolean),
    );
    const ri = repoInfoRef.current;
    (async () => {
      try {
        // badge-update and stats are independent — fire both in parallel so the stats
        // fetch does not have to wait for badge-update to complete first.
        const [, statsRes] = await Promise.all([
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
          }),
          fetch(`/api/stats/${owner}/${repo}`),
        ]);
        const data = statsRes.ok ? await statsRes.json() : null;
        if (data) setServerStats(data);
      } catch { /* fire-and-forget */ }
    })();
  }, [owner, repo, setServerStats]);

  return { cacheCheckDone, lastDbScan, dataSource };
};
