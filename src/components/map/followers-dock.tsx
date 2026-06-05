// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { Menu, X, Users } from "lucide-react";
import { CLUSTER_RADIUS } from "@/components/map/stargazer-map";

type ViewMode = "clusters" | "heatmap";
type FollowerFilter = "all" | "elite" | "vhigh" | "high" | "mid" | "low";

type Props = {
  hasPoints: boolean;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  followerFilter: FollowerFilter;
  setFollowerFilter: (v: FollowerFilter) => void;
  clusterRadius: number;
  setClusterRadius: (v: number) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  followersCount: number;
  totalCount: number;
  onFollowersOpen: () => void;
};

export const FollowersDock = ({
  hasPoints,
  viewMode, setViewMode,
  followerFilter, setFollowerFilter,
  clusterRadius, setClusterRadius,
  sidebarOpen, setSidebarOpen,
  followersCount, totalCount, onFollowersOpen,
}: Props) => {
  return (
    <>
      {/* Mobile toggle */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden absolute bottom-6 left-4 z-10 bg-background/90 border border-border rounded-lg px-3 py-2.5 backdrop-blur-md flex items-center gap-2 text-xs text-muted hover:text-foreground hover:border-accent-blue/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          aria-label="Open controls"
        >
          <Menu size={14} aria-hidden="true" />
          Controls
          {followerFilter !== "all" && (
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
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex-1 text-xs font-medium py-1 rounded transition-colors capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
                    isActive && mode === "clusters"
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

        {/* Map controls — density + follower filter */}
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

            {/* Density slider */}
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

            {/* Follower filter */}
            <div role="radiogroup" aria-label="Filter by follower count">
              {([
                { key: "all", label: "All", dot: null },
                { key: "elite", label: "5k+ followers", dot: "bg-accent-purple" },
                { key: "vhigh", label: "1k+ followers", dot: "bg-accent-red" },
                { key: "high", label: "500+ followers", dot: "bg-accent-orange" },
                { key: "mid", label: "100–500", dot: "bg-accent-blue" },
                { key: "low", label: "<100", dot: "bg-muted" },
              ] as const).map(({ key, label, dot }) => {
                const active = followerFilter === key;
                return (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFollowerFilter(active && key !== "all" ? "all" : key)}
                    className={`flex items-center gap-2 rounded px-1.5 py-2 text-xs transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 w-full ${
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
          </div>
        )}

        {/* Followers list button */}
        {followersCount > 0 && (
          <button
            onClick={onFollowersOpen}
            className="bg-background/90 border border-border rounded-lg px-3 py-2.5 text-xs text-muted hover:text-foreground hover:border-accent-blue/50 backdrop-blur-md transition-all flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
          >
            <Users size={16} className="text-accent-blue flex-shrink-0" aria-hidden="true" />
            <span>Followers</span>
            <span className="bg-surface-alt text-foreground text-2xs font-medium px-1.5 py-0.5 rounded tabular-nums">
              {totalCount > 0 ? totalCount.toLocaleString() : followersCount.toLocaleString()}
            </span>
          </button>
        )}
      </div>
    </>
  );
};
