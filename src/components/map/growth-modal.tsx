// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { GrowthChart } from "@/components/map/growth-chart";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { UnmappedEntry } from "@/hooks/useScanController";
import type { GrowthResponse } from "@/app/api/stats/[owner]/[repo]/growth/route";

type GrowthModalProps = {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  points: StargazerPoint[];
  unmapped: UnmappedEntry[];
  totalCount?: number;
};

export const GrowthModal = ({ open, onClose, owner, repo, points, unmapped, totalCount }: GrowthModalProps) => {
  const [apiGrowthData, setApiGrowthData] = useState<[string, number][] | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open || apiGrowthData !== null) return;
    const ac = new AbortController();
    setFetching(true);
    fetch(`/api/stats/${owner}/${repo}/growth`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<GrowthResponse>) : null))
      .then((data) => {
        if (data && data.weeks.length > 0) {
          setApiGrowthData(data.weeks.map((w) => [w.week, w.count] as [string, number]));
        } else {
          setApiGrowthData([]);
        }
      })
      .catch((e: unknown) => { if ((e as { name?: string })?.name !== "AbortError") setApiGrowthData([]); })
      .finally(() => setFetching(false));
    return () => ac.abort();
  }, [open, apiGrowthData, owner, repo]);

  // Expensive — only runs when modal is open; falls back to API data when available
  const growthData = useMemo(() => {
    if (!open) return [];
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
  }, [open, points, unmapped]);

  const chartData = apiGrowthData && apiGrowthData.length > 0 ? apiGrowthData : growthData;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div>
          <h2 className="text-foreground font-semibold text-sm">Star Growth</h2>
          <p className="text-muted text-2xs mt-0.5">
            {fetching ? "Loading…" : chartData.length > 0 ? `${chartData.length} weeks · ${(totalCount ?? points.length + unmapped.length).toLocaleString()} total stars` : "No timestamp data available"}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close star growth" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
      </div>
      <div className="px-5 py-5">
        {fetching ? (
          <div className="flex items-center justify-center h-40 text-muted text-sm">Loading growth data…</div>
        ) : chartData.length > 0 ? (
          <GrowthChart data={chartData} totalStars={totalCount} />
        ) : (
          <div className="flex items-center justify-center h-40 text-muted text-sm">No star timestamp data for this repo.</div>
        )}
      </div>
    </Modal>
  );
};
