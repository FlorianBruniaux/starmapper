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
  /** Passed in so useScanController can also write serverStats after a fresh scan. */
  setServerStats?: React.Dispatch<React.SetStateAction<RepoStats | null>>;
};

type Result = {
  cacheCheckDone: boolean;
  lastDbScan: string | null;
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
  setServerStats: externalSetServerStats,
}: Options): Result => {
  const [cacheCheckDone, setCacheCheckDone] = useState(false);
  const [lastDbScan, setLastDbScan] = useState<string | null>(null);
  // Local state is used when no external setter is provided (e.g. in tests).
  const [_serverStats, _setServerStats] = useState<RepoStats | null>(null);
  const setServerStats = externalSetServerStats ?? _setServerStats;

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
    (async () => {
      try {
        const r = await fetch(`/api/stargazer-cache/${owner}/${repo}`, { signal: ac.signal });
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
      } catch {
        // network errors + AbortError are silently ignored
      } finally {
        setCacheCheckDone(true);
      }
    })();
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
    (async () => {
      try {
        await fetch("/api/badge-update", {
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
        });
        const statsRes = await fetch(`/api/stats/${owner}/${repo}`);
        const data = statsRes.ok ? await statsRes.json() : null;
        if (data) setServerStats(data);
      } catch { /* fire-and-forget */ }
    })();
  }, [owner, repo]);

  return { cacheCheckDone, lastDbScan };
};
