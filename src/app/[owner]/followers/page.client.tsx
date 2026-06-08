// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Users, Loader2 } from "lucide-react";
import { Header } from "@/components/header";
import { FollowersPanel } from "@/components/map/followers-panel";
import { FollowersDock } from "@/components/map/followers-dock";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { CLUSTER_RADIUS } from "@/components/map/stargazer-map";
import {
  followersScanReducer,
  useFollowersScanController,
} from "@/hooks/useFollowersScanController";
import { getStoredToken } from "@/lib/token";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/map-style-urls";
import { FollowersUserSwitcher } from "@/components/followers-user-switcher";
import type { StargazerPoint } from "@/app/api/chunk/route";

const TokenModal = dynamic(
  () => import("@/components/token-modal").then((m) => ({ default: m.TokenModal })),
  { ssr: false },
);

type Props = {
  params: Promise<{ owner: string }>;
};

export default function FollowersPageClient({ params }: Props) {
  const { owner } = use(params);

  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [scan, dispatch] = useReducer(followersScanReducer, {
    points: [],
    unmapped: [],
    processed: 0,
  });
  const { points, unmapped } = scan;

  const [total, setTotal] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; login: string } | null>(
    null,
  );
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getStoredToken());

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  const { status, error, handleStartScan, handleTokenClose } = useFollowersScanController({
    login: owner,
    dispatch,
    setTotal,
    setTokenOpen,
    setHasToken,
    ghHeaders,
  });

  // Map controls
  type ViewMode = "clusters" | "heatmap";
  type FollowerFilter = "all" | "elite" | "vhigh" | "high" | "mid" | "low";
  const mapControlsRef = useRef<{ setViewMode: (m: ViewMode) => void } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("clusters");
  const [followerFilter, setFollowerFilter] = useState<FollowerFilter>("all");
  const [clusterRadius, setClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [debouncedClusterRadius, setDebouncedClusterRadius] = useState<number>(CLUSTER_RADIUS.default);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedClusterRadius(clusterRadius), 150);
    return () => clearTimeout(t);
  }, [clusterRadius]);

  useEffect(() => {
    mapControlsRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  const handleMapReady = useCallback(
    (controls: { setViewMode: (m: ViewMode) => void }) => {
      mapControlsRef.current = controls;
    },
    [],
  );

  // SAFETY: FollowerPoint is structurally compatible with StargazerPoint for map rendering
  // (map only uses lat/lng/login/followers/avatarUrl). starredAt and linkedinUrl are null in
  // StargazerPoint anyway, and FollowerPoint does not carry them.
  const allMapPoints = useMemo(() => points as unknown as StargazerPoint[], [points]);

  const filteredMapPoints = useMemo(() => {
    if (followerFilter === "elite") return allMapPoints.filter((p) => p.followers >= 5000);
    if (followerFilter === "vhigh") return allMapPoints.filter((p) => p.followers >= 1000);
    if (followerFilter === "high") return allMapPoints.filter((p) => p.followers >= 500);
    if (followerFilter === "mid") return allMapPoints.filter((p) => p.followers >= 100 && p.followers < 500);
    if (followerFilter === "low") return allMapPoints.filter((p) => p.followers < 100);
    return allMapPoints;
  }, [allMapPoints, followerFilter]);

  const isScanning = status === "loading" || status === "waiting";
  const isDone = status === "done";

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Header
        sticky
        backLink="/"
        nav={<FollowersUserSwitcher currentOwner={owner} />}
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      <main className="relative flex-1 overflow-hidden">
        {/* Map fills the entire space */}
        <StargazerMapDynamic
          points={filteredMapPoints}
          flyTarget={flyTarget}
          onFlyDone={() => setFlyTarget(null)}
          onReady={handleMapReady}
          clusterRadius={debouncedClusterRadius}
          styleUrl={mapStyleUrl}
        />

        {/* Map controls dock */}
        <FollowersDock
          hasPoints={allMapPoints.length > 0}
          viewMode={viewMode}
          setViewMode={setViewMode}
          followerFilter={followerFilter}
          setFollowerFilter={setFollowerFilter}
          clusterRadius={clusterRadius}
          setClusterRadius={setClusterRadius}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          followersCount={allMapPoints.length}
          totalCount={total}
          onFollowersOpen={() => setPanelOpen(true)}
        />

        {/* Top bar — centered, floating above the map */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 max-w-[90vw]">
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-lg">
            {/* Title */}
            <span className="text-foreground text-sm font-medium whitespace-nowrap">
              @{owner}&apos;s followers
            </span>

            {/* Scan button (idle) */}
            {status === "idle" && (
              <button
                onClick={handleStartScan}
                className="flex items-center gap-1.5 bg-accent-green text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <Users size={13} aria-hidden="true" />
                Map followers
              </button>
            )}

            {/* Scanning progress */}
            {isScanning && (
              <div className="flex items-center gap-1.5 text-muted text-xs whitespace-nowrap">
                <Loader2 size={13} className="animate-spin text-accent-blue" aria-hidden="true" />
                {status === "waiting" ? "Waiting for rate limit…" : "Scanning…"}
              </div>
            )}

            {/* Followers count pill (done or in progress with data) */}
            {(isDone || points.length > 0) && total > 0 && (
              <button
                onClick={() => setPanelOpen(true)}
                className="flex items-center gap-1 bg-surface-alt border border-border rounded-md px-2 py-1 text-xs text-foreground hover:border-accent-blue/50 hover:text-accent-blue transition-colors whitespace-nowrap"
                aria-label={`${points.length.toLocaleString()} followers mapped — open list`}
              >
                <Users size={12} aria-hidden="true" />
                <span className="tabular-nums">{points.length.toLocaleString()}</span>
                <span className="text-muted-subtle">/ {total.toLocaleString()}</span>
              </button>
            )}

            {/* Error message */}
            {status === "error" && error && (
              <span className="text-accent-red text-xs truncate max-w-48" role="alert">
                {error}
              </span>
            )}
          </div>
        </div>

        {/* Followers side panel */}
        <FollowersPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          points={points}
          unmapped={unmapped}
          setFlyTarget={setFlyTarget}
        />
      </main>

      {/* Token modal — only rendered when needed */}
      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
