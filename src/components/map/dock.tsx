// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

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
}: Props) => {
  return (
    <>
      {/* Mobile toggle — visible only when sidebar is collapsed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden absolute bottom-6 left-4 z-10 bg-background/90 border border-border rounded-lg px-3 py-2.5 backdrop-blur-md flex items-center gap-2 text-xs text-muted hover:text-foreground hover:border-accent-blue/50 transition-all"
          aria-label="Open controls"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z" />
          </svg>
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
                  className={`flex-1 text-xs font-medium py-1 rounded transition-colors capitalize ${
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
                className="lg:hidden text-muted hover:text-foreground transition-colors p-0.5 -mr-0.5 rounded"
                aria-label="Close controls"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
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
                  className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs transition-colors text-left ${
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
              hover:border-accent-blue/50 backdrop-blur-md transition-all flex items-center gap-2"
            title="Stargazer stats"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-blue flex-shrink-0" aria-hidden="true">
              <path d="M1.5 1.75a.75.75 0 00-1.5 0v12.5c0 .414.336.75.75.75h14.5a.75.75 0 000-1.5H1.5V1.75zm13.28 4.47a.75.75 0 00-1.06-1.06L10 8.94 7.53 6.47a.75.75 0 00-1.06 0L3.22 9.72a.75.75 0 001.06 1.06L7 8.06l2.47 2.47a.75.75 0 001.06 0l4.25-4.32z"/>
            </svg>
            <span>Stats</span>
          </button>
        )}

        {allStargazersCount > 0 && (
          <button
            onClick={() => setAllOpen(true)}
            className="bg-background/90 border border-border rounded-lg
              px-3 py-2.5 text-xs text-muted hover:text-foreground
              hover:border-accent-purple/50 backdrop-blur-md transition-all flex items-center gap-2"
            title="All stargazers"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-purple flex-shrink-0" aria-hidden="true">
              <path d="M2 5.5a3.5 3.5 0 115.898 2.549 5.508 5.508 0 013.034 4.084.75.75 0 11-1.482.235 4 4 0 00-7.9 0 .75.75 0 01-1.482-.236A5.507 5.507 0 013.102 8.05 3.493 3.493 0 012 5.5zM11 4a3 3 0 102.22 5.018 5.01 5.01 0 012.56 3.012.75.75 0 11-1.45.39 3.504 3.504 0 00-6.66 0 .75.75 0 11-1.45-.39A5.01 5.01 0 018.78 9.018 3 3 0 0111 4z"/>
            </svg>
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
              hover:border-accent-green/50 backdrop-blur-md transition-all flex items-center gap-2"
            title="Star growth chart"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-green flex-shrink-0" aria-hidden="true">
              <path d="M1.5 12.5 5 8l3 3 3.5-5 3 3"/>
            </svg>
            <span>Growth</span>
          </button>
        )}

        <a
          href={`https://star-history.com/#${owner}/${repo}&type=Date`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-background/90 border border-border rounded-lg
            px-3 py-2.5 text-xs text-muted hover:text-foreground
            hover:border-accent-orange/50 backdrop-blur-md transition-all flex items-center gap-2"
          title="View star history on star-history.com"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-orange flex-shrink-0" aria-hidden="true">
            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
          </svg>
          <span>History</span>
        </a>

        {/* Timelapse button */}
        {hasTimelapse && (
          <button
            onClick={() => {
              setTimelapseActive(!timelapseActive);
            }}
            className={`bg-background/90 border rounded-lg
              px-3 py-2.5 text-xs backdrop-blur-md transition-all flex items-center gap-2 ${
              timelapseActive
                ? "border-accent-blue/60 text-accent-blue bg-accent-blue/10"
                : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
            }`}
            title="Replay stars over time"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0" aria-hidden="true">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v3.67l2.069 1.238a.75.75 0 0 1-.756 1.292l-2.421-1.45A.75.75 0 0 1 7 9.75v-5a.75.75 0 0 1 1.5 0Z"/>
            </svg>
            <span>Timelapse</span>
          </button>
        )}

        {/* Badge button */}
        <button
          onClick={() => setBadgeOpen(true)}
          className="bg-background/90 border border-border rounded-lg
            px-3 py-2.5 text-xs text-muted hover:text-foreground
            hover:border-accent-blue/50 backdrop-blur-md transition-all flex items-center gap-2"
          title="Get README badge"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue flex-shrink-0" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
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
            shadow-[0_0_12px_rgba(35,134,54,0.3)] hover:shadow-[0_0_20px_rgba(46,160,67,0.45)]"
          aria-label="Share this stargazer map"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0" aria-hidden="true">
            <path d="M2.75 3.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 010 1.5h-2A1.75 1.75 0 011 11.25v-7.5C1 2.784 1.784 2 2.75 2h2.5a.75.75 0 010 1.5h-2.5zm10.5 0a.75.75 0 010-1.5h-4.5a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0V4.56L13.47 8l-3.97 3.44V9.75a.75.75 0 00-1.5 0v3.5c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-2.5z"/>
          </svg>
          Share
        </button>
      </div>
    </>
  );
};
