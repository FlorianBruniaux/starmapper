// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { Menu, X, TrendingUp, Users, Activity, Radio, Star, Clock, Layers, Share2 } from "lucide-react";
import { CLUSTER_RADIUS } from "@/components/map/stargazer-map";

type ViewMode = "clusters" | "heatmap";
type FollowerFilter = "all" | "high" | "mid" | "low";

type Props = {
  owner: string;
  repo: string;
  // Data availability flags
  hasStats: boolean;
  allStargazersCount: number;
  hasGrowthData: boolean;
  // Compare state
  compareOwner: string | null;
  compareRepo: string | null;
  // View controls
  hasPoints: boolean;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  // Filter
  followerMapFilter: FollowerFilter;
  setFollowerMapFilter: (v: FollowerFilter) => void;
  // Cluster density slider
  clusterRadius: number;
  setClusterRadius: (v: number) => void;
  // Mobile sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  // Modal openers
  setStatsOpen: (v: boolean) => void;
  setAllOpen: (v: boolean) => void;
  setGrowthOpen: (v: boolean) => void;
  setBadgeOpen: (v: boolean) => void;
  setShareOpen: (v: boolean) => void;
  // Timelapse
  hasTimelapse: boolean;
  timelapseActive: boolean;
  setTimelapseActive: (v: boolean) => void;
  // Watch mode
  watchActive: boolean;
  watchNewCount: number;
  watchCountries: string[];
  onWatchStart: () => void;
  onWatchStop: () => void;
};

export const Dock = ({
  owner, repo,
  hasStats, allStargazersCount, hasGrowthData,
  compareOwner, compareRepo,
  hasPoints, viewMode, setViewMode,
  followerMapFilter, setFollowerMapFilter,
  clusterRadius, setClusterRadius,
  sidebarOpen, setSidebarOpen,
  setStatsOpen, setAllOpen, setGrowthOpen, setBadgeOpen, setShareOpen,
  hasTimelapse, timelapseActive, setTimelapseActive,
  watchActive, watchNewCount, watchCountries, onWatchStart, onWatchStop,
}: Props) => {
  return (
    <>
      {/* Mobile toggle — visible only when sidebar is collapsed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden absolute bottom-6 left-4 z-10 bg-background/90 border border-border rounded-lg px-3 py-2.5 backdrop-blur-md flex items-center gap-2 text-xs text-muted hover:text-foreground hover:border-accent-blue/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          aria-label="Open controls"
        >
          <Menu size={14} aria-hidden="true" />
          Controls
          {followerMapFilter !== "all" && (
            <span className="size-1.5 rounded-full bg-accent-blue inline-block" />
          )}
        </button>
      )}

      <div className={`absolute bottom-6 left-4 z-10 flex-col gap-2 ${sidebarOpen ? "flex" : "hidden"} lg:flex`}>

        {/* View mode toggle — Clusters / Heatmap */}
        {hasPoints && (
          <div className="bg-background/90 border border-border rounded-lg p-1 backdrop-blur-md flex gap-1">
            {(["clusters", "heatmap"] as const).map((mode) => {
              const isActive = viewMode === mode;
              const isDisabled = !!(compareOwner && compareRepo);
              return (
                <button
                  key={mode}
                  onClick={() => !isDisabled && setViewMode(mode)}
                  disabled={isDisabled}
                  title={isDisabled ? "Disable compare mode first" : undefined}
                  className={`flex-1 text-xs font-medium py-1 rounded transition-colors capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed text-muted"
                      : isActive && mode === "clusters"
                        ? "bg-accent-blue/15 text-accent-blue"
                        : isActive && mode === "heatmap"
                          ? "bg-accent-orange/15 text-accent-orange"
                          : "text-muted hover:text-foreground hover:bg-surface"
                  }`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        )}

        {/* Map controls (density + follower filter) */}
        {viewMode === "clusters" && (
          <div className="bg-background/90 border border-border rounded-lg px-3 py-2 backdrop-blur-md flex flex-col gap-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-2xs text-muted-subtle uppercase tracking-widest">Map controls</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden text-muted hover:text-foreground transition-colors p-0.5 -mr-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
                aria-label="Close controls"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>

            {/* Cluster density slider */}
            <div className="flex flex-col gap-1 pb-1">
              <div className="flex items-center gap-1">
                <span className="text-2xs text-muted-subtle uppercase tracking-widest">Density</span>
                {clusterRadius !== CLUSTER_RADIUS.default && (
                  <span className="size-1.5 rounded-full bg-accent-blue inline-block" />
                )}
              </div>
              <input
                type="range"
                min={CLUSTER_RADIUS.min}
                max={CLUSTER_RADIUS.max}
                step={CLUSTER_RADIUS.step}
                value={clusterRadius}
                onChange={(e) => setClusterRadius(Number(e.target.value))}
                className="sm-slider"
                aria-label="Cluster density"
              />
              <div className="flex justify-between">
                <span className="text-2xs text-muted-subtle">fine</span>
                <span className="text-2xs text-muted-subtle">broad</span>
              </div>
            </div>

            <div className="border-t border-border-subtle" />

            {([
              { key: "all", label: "All", dot: null },
              { key: "high", label: "500+ followers", dot: "bg-accent-red" },
              { key: "mid", label: "100–500", dot: "bg-accent-orange" },
              { key: "low", label: "<100", dot: "bg-accent-blue" },
            ] as const).map(({ key, label, dot }) => {
              const active = followerMapFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFollowerMapFilter(active && key !== "all" ? "all" : key)}
                  className={`flex items-center gap-2 rounded px-1.5 py-2 text-xs transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
                    active ? "bg-surface-alt text-foreground" : "text-muted hover:bg-surface hover:text-foreground"
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
        )}

        {hasStats && (
          <button
            onClick={() => setStatsOpen(true)}
            className="bg-background/90 border border-border rounded-lg
              px-3 py-2.5 text-xs text-muted hover:text-foreground
              hover:border-accent-blue/50 backdrop-blur-md transition-all flex items-center gap-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
            title="Stargazer stats"
          >
            <TrendingUp size={16} className="text-accent-blue flex-shrink-0" aria-hidden="true" />
            <span>Stats</span>
          </button>
        )}

        {allStargazersCount > 0 && (
          <button
            onClick={() => setAllOpen(true)}
            className="bg-background/90 border border-border rounded-lg
              px-3 py-2.5 text-xs text-muted hover:text-foreground
              hover:border-accent-purple/50 backdrop-blur-md transition-all flex items-center gap-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
            title="All stargazers"
          >
            <Users size={16} className="text-accent-purple flex-shrink-0" aria-hidden="true" />
            <span>Stargazers</span>
            <span className="bg-border text-muted text-2xs px-1.5 py-px rounded-full tabular-nums leading-none ml-auto">
              {allStargazersCount.toLocaleString()}
            </span>
          </button>
        )}

        {hasGrowthData && (
          <button
            onClick={() => setGrowthOpen(true)}
            className="bg-background/90 border border-border rounded-lg
              px-3 py-2.5 text-xs text-muted hover:text-foreground
              hover:border-accent-green/50 backdrop-blur-md transition-all flex items-center gap-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
            title="Star growth chart"
          >
            <Activity size={16} className="text-accent-green flex-shrink-0" aria-hidden="true" />
            <span>Growth</span>
          </button>
        )}

        {hasGrowthData && (
          <button
            onClick={watchActive ? onWatchStop : onWatchStart}
            className={`border rounded-lg px-3 py-2.5 text-xs backdrop-blur-md transition-all flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
              watchActive
                ? "bg-accent-green/10 border-accent-green/50 text-accent-green"
                : "bg-background/90 border-border text-muted hover:text-foreground hover:border-accent-green/50"
            }`}
            title={watchActive ? "Stop watching" : "Watch for new stars in real time"}
          >
            {watchActive ? (
              <>
                <span className="relative flex size-2 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-accent-green" />
                </span>
                <span className="tabular-nums">
                  {watchNewCount > 0
                    ? `+${watchNewCount} ★${watchCountries.length > 0 ? ` · ${watchCountries.slice(0, 2).join(", ")}` : ""}`
                    : "Watching…"}
                </span>
              </>
            ) : (
              <>
                <Radio size={14} className="flex-shrink-0" aria-hidden="true" />
                <span>Watch</span>
              </>
            )}
          </button>
        )}

        <a
          href={`https://star-history.com/#${owner}/${repo}&type=Date`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-background/90 border border-border rounded-lg
            px-3 py-2.5 text-xs text-muted hover:text-foreground
            hover:border-accent-orange/50 backdrop-blur-md transition-all flex items-center gap-2
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          title="View star history on star-history.com"
        >
          <Star size={16} className="text-accent-orange flex-shrink-0" aria-hidden="true" />
          <span>History</span>
        </a>

        {/* Timelapse button */}
        {hasTimelapse && (
          <button
            onClick={() => {
              setTimelapseActive(!timelapseActive);
            }}
            className={`bg-background/90 border rounded-lg
              px-3 py-2.5 text-xs backdrop-blur-md transition-all flex items-center gap-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
              timelapseActive
                ? "border-accent-blue/60 text-accent-blue bg-accent-blue/10"
                : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
            }`}
            title="Replay stars over time"
          >
            <Clock size={16} className="flex-shrink-0" aria-hidden="true" />
            <span>Timelapse</span>
          </button>
        )}

        {/* Badge button */}
        <button
          onClick={() => setBadgeOpen(true)}
          className="bg-background/90 border border-border rounded-lg
            px-3 py-2.5 text-xs text-muted hover:text-foreground
            hover:border-accent-blue/50 backdrop-blur-md transition-all flex items-center gap-2
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          title="Get README badge"
        >
          <Layers size={16} className="text-accent-blue flex-shrink-0" aria-hidden="true" />
          <span>Badge</span>
        </button>

        {/* Share CTA */}
        <button
          onClick={() => setShareOpen(true)}
          className="bg-accent-green-emphasis hover:opacity-90 active:opacity-80
            border border-accent-green-emphasis/60 hover:border-accent-green/60
            rounded-lg px-3 py-2.5
            text-white text-xs font-semibold
            backdrop-blur-md transition-all duration-150
            flex items-center gap-2 w-full
            shadow-[0_0_12px_rgba(14,152,86,0.3)] hover:shadow-[0_0_20px_rgba(16,208,112,0.35)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          aria-label="Share this stargazer map"
        >
          <Share2 size={16} className="flex-shrink-0" aria-hidden="true" />
          Share
        </button>
      </div>
    </>
  );
};
