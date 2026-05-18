// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { LANGUAGE_COLORS } from "@/lib/language-colors";
import type { TrendingRepo, TrendingReposResponse } from "@/app/api/trending/repos/route";
import type { TrendingMapResponse } from "@/app/api/trending/map/route";
import type { StargazerPoint } from "@/app/api/chunk/route";

type Window = "7d" | "30d" | "90d";

const WINDOW_LABELS: Record<Window, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

const velKey = (w: Window) => (w === "7d" ? "stars7d" : w === "30d" ? "stars30d" : "stars90d") as keyof TrendingRepo;

const formatK = (n: number) =>
  n >= 1000 ? `+${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `+${n}`;

const LangDot = ({ language }: { language: string | null }) => {
  if (!language) return null;
  const color = LANGUAGE_COLORS[language] ?? "#8b949e";
  return (
    <span
      className="inline-block size-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
};

const SkeletonRow = () => (
  <div className="flex items-center gap-3 py-3 border-b border-border-subtle animate-pulse motion-reduce:animate-none">
    <div className="w-5 h-3 rounded bg-surface-alt shrink-0" />
    <div className="flex-1 h-3 rounded bg-surface-alt" />
    <div className="w-10 h-3 rounded bg-surface-alt shrink-0" />
  </div>
);

export default function TrendingPage() {
  const [repos, setRepos] = useState<TrendingRepo[]>([]);
  const [meta, setMeta] = useState<{ total: number } | null>(null);
  const [mapPoints, setMapPoints] = useState<StargazerPoint[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  const [window, setWindow] = useState<Window>("7d");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/trending/repos", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          setReposError(body.error === "trending_mv_empty"
            ? "Trending data is being initialized — check back soon."
            : "Could not load trending data.");
          return;
        }
        const json = await res.json() as TrendingReposResponse;
        setRepos(json.repos);
        setMeta(json.meta);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setReposError("Could not load trending data.");
      })
      .finally(() => setReposLoading(false));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/trending/map", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json() as TrendingMapResponse;
        setMapPoints(json.mapPoints);
      })
      .catch(() => {})
      .finally(() => setMapLoading(false));
    return () => ctrl.abort();
  }, []);

  const sorted = useMemo<TrendingRepo[]>(() => {
    const key = velKey(window);
    return [...repos].sort((a, b) => (b[key] as number) - (a[key] as number));
  }, [repos, window]);

  const reposWithMap = useMemo(() => repos.filter((r) => r.hasMap).length, [repos]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header sticky showNav innerMaxWidth="max-w-full" />

      <div className="flex flex-1 overflow-hidden pt-14">
        {/* Left — ranked list */}
        <aside
          className="w-full max-w-sm shrink-0 flex flex-col border-r border-border bg-surface overflow-hidden"
          aria-label="Trending repositories"
        >
          {/* Panel header */}
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <h1 className="text-base font-semibold text-foreground">Trending on StarMapper</h1>
            {!reposLoading && meta && (
              <p className="text-xs text-muted mt-0.5 tabular-nums">
                {meta.total} repos tracked
                {reposWithMap > 0 && ` · ${reposWithMap} on map`}
              </p>
            )}

            {/* Period toggle */}
            <div className="flex gap-1 mt-3" role="group" aria-label="Time window">
              {(["7d", "30d", "90d"] as Window[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWindow(w)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    window === w
                      ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30"
                      : "text-muted hover:text-foreground border border-transparent hover:border-border"
                  }`}
                  aria-pressed={window === w}
                >
                  {WINDOW_LABELS[w]}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <ol className="flex-1 overflow-y-auto divide-y divide-border-subtle" aria-busy={reposLoading}>
            {reposLoading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <li key={i} className="px-4">
                  <SkeletonRow />
                </li>
              ))
            ) : reposError ? (
              <li className="px-4 py-8 text-center">
                <p className="text-muted text-sm">{reposError}</p>
              </li>
            ) : sorted.length === 0 ? (
              <li className="px-4 py-8 text-center">
                <p className="text-muted text-sm">No trending repos yet.</p>
              </li>
            ) : (
              sorted.map((repo, idx) => {
                const vel = repo[velKey(window)] as number;
                return (
                  <li key={`${repo.owner}/${repo.repo}`}>
                    <Link
                      href={`/${repo.owner}/${repo.repo}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt transition-colors group"
                    >
                      {/* Rank */}
                      <span className="text-xs text-muted-subtle tabular-nums w-5 text-right shrink-0">
                        {idx + 1}
                      </span>

                      {/* Repo info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground group-hover:text-accent-blue transition-colors truncate font-medium leading-snug">
                          {repo.owner}/{repo.repo}
                        </p>
                        {repo.language && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <LangDot language={repo.language} />
                            <span className="text-xs text-muted-subtle">{repo.language}</span>
                          </div>
                        )}
                      </div>

                      {/* Velocity */}
                      <div className="shrink-0 text-right">
                        <span className="text-xs font-semibold text-accent-green tabular-nums">
                          {formatK(vel)}
                        </span>
                        <p className="text-xs text-muted-subtle tabular-nums">
                          {repo.totalCount.toLocaleString()} total
                        </p>
                      </div>

                      {/* Map indicator */}
                      {repo.hasMap && (
                        <span
                          className="shrink-0 size-1.5 rounded-full bg-accent-blue/60"
                          title="On map"
                          aria-label="Has geo data on map"
                        />
                      )}
                    </Link>
                  </li>
                );
              })
            )}
          </ol>
        </aside>

        {/* Right — map */}
        <div className="flex-1 relative">
          {!mapLoading && mapPoints.length === 0 && !reposError && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <p className="text-muted text-sm bg-surface/80 px-4 py-2 rounded-lg border border-border">
                No geo data yet for top repos — scan them first.
              </p>
            </div>
          )}
          <StargazerMapDynamic points={mapPoints} />
        </div>
      </div>
    </div>
  );
}
