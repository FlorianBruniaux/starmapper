// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useState, useMemo, useEffect } from "react";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { UnmappedEntry } from "@/hooks/useScanController";
import type { TimelapseSpeed } from "@/components/map/timelapse-bar";

// Returns the YYYY-MM-DD of the Monday of the week containing dateStr (YYYY-MM-DD)
const getWeekMonday = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, …
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
};

export type TimelapseState = {
  timelapseActive: boolean;
  setTimelapseActive: (v: boolean) => void;
  timelapseIndex: number;
  setTimelapseIndex: React.Dispatch<React.SetStateAction<number>>;
  timelapseAutoPlay: boolean;
  setTimelapseAutoPlay: React.Dispatch<React.SetStateAction<boolean>>;
  timelapseSpeed: TimelapseSpeed;
  setTimelapseSpeed: (v: TimelapseSpeed) => void;
  weekBuckets: string[];
  filteredMapPoints: StargazerPoint[];
  cumulativeAtCurrentWeek: number;
};

export const useTimelapse = (
  points: StargazerPoint[],
  unmapped: UnmappedEntry[],
  followerMapFilter: "all" | "elite" | "vhigh" | "high" | "mid" | "low",
): TimelapseState => {
  const [timelapseActive, setTimelapseActive] = useState(false);
  const [timelapseIndex, setTimelapseIndex] = useState(0);
  const [timelapseAutoPlay, setTimelapseAutoPlay] = useState(false);
  const [timelapseSpeed, setTimelapseSpeed] = useState<TimelapseSpeed>(800);

  // Weekly buckets — one entry per week (Monday YYYY-MM-DD) with at least 1 star
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

  // Cumulative star count per week from ALL users (mapped + unmapped) with starredAt
  const cumulativeSeries = useMemo(() => {
    const weekCountMap = new Map<string, number>();
    for (const u of [...points, ...unmapped]) {
      if (!u.starredAt) continue;
      const week = getWeekMonday(u.starredAt.slice(0, 10));
      weekCountMap.set(week, (weekCountMap.get(week) ?? 0) + 1);
    }
    const sorted = [...weekCountMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let running = 0;
    return sorted.map(([week, count]): [string, number] => {
      running += count;
      return [week, running];
    });
  }, [points, unmapped]);

  const cumulativeAtCurrentWeek = useMemo(() => {
    if (!timelapseActive || weekBuckets.length === 0 || cumulativeSeries.length === 0) return 0;
    const currentWeek = weekBuckets[timelapseIndex] ?? weekBuckets[0];
    let result = 0;
    for (const [week, cum] of cumulativeSeries) {
      if (week <= currentWeek) result = cum;
      else break;
    }
    return result;
  }, [cumulativeSeries, timelapseActive, timelapseIndex, weekBuckets]);

  // Map points filtered by follower tier and, when active, timelapse cutoff date
  const filteredMapPoints = useMemo(() => {
    let result = points;
    if (followerMapFilter === "elite") result = result.filter((p) => p.followers >= 5000);
    else if (followerMapFilter === "vhigh") result = result.filter((p) => p.followers >= 1000);
    else if (followerMapFilter === "high") result = result.filter((p) => p.followers >= 500);
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

  return {
    timelapseActive,
    setTimelapseActive,
    timelapseIndex,
    setTimelapseIndex,
    timelapseAutoPlay,
    setTimelapseAutoPlay,
    timelapseSpeed,
    setTimelapseSpeed,
    weekBuckets,
    filteredMapPoints,
    cumulativeAtCurrentWeek,
  };
};
