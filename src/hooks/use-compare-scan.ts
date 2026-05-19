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
