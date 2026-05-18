// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useState, useRef, useEffect, useCallback } from "react";

const AUTO_STOP_MS = 10 * 60_000; // auto-stop after 10 min of no new stars

export type WatchModeState = {
  watchActive: boolean;
  watchNewCount: number;
  watchCountries: string[];
  handleWatchStart: () => void;
  handleWatchStop: () => void;
};

export const useWatchMode = (owner: string, repo: string): WatchModeState => {
  const [watchActive, setWatchActive] = useState(false);
  const [watchSince, setWatchSince] = useState<string | null>(null);
  const [watchNewCount, setWatchNewCount] = useState(0);
  const [watchCountries, setWatchCountries] = useState<string[]>([]);
  const watchIdleRef = useRef(0);

  useEffect(() => {
    if (!watchActive || !watchSince) return;
    watchIdleRef.current = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/watch/${owner}/${repo}?since=${encodeURIComponent(watchSince)}`);
        if (!res.ok) return;
        const data = await res.json() as { newCount: number; countries: string[] };
        if (data.newCount > 0) {
          setWatchNewCount((prev) => prev + data.newCount);
          setWatchCountries(data.countries);
          watchIdleRef.current = 0;
        } else {
          watchIdleRef.current += 60_000;
          if (watchIdleRef.current >= AUTO_STOP_MS) setWatchActive(false);
        }
      } catch { /* network errors silently ignored */ }
    };

    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, [watchActive, watchSince, owner, repo]);

  const handleWatchStart = useCallback(() => {
    setWatchActive(true);
    setWatchSince(new Date().toISOString());
    setWatchNewCount(0);
    setWatchCountries([]);
  }, []);

  const handleWatchStop = useCallback(() => {
    setWatchActive(false);
    setWatchSince(null);
  }, []);

  return { watchActive, watchNewCount, watchCountries, handleWatchStart, handleWatchStop };
};
