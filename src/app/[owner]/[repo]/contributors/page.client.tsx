// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { GitCommit, Loader2 } from "lucide-react";
import { Header } from "@/components/header";
import { TourTrigger } from "@/components/tour/tour-trigger";
import { ContributorsPanel } from "@/components/map/contributors-panel";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { CLUSTER_RADIUS } from "@/components/map/stargazer-map";
import {
  contributorsScanReducer,
  useContributorsScanController,
} from "@/hooks/useContributorsScanController";
import { getStoredToken } from "@/lib/token";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/map-style-urls";
import type { StargazerPoint } from "@/app/api/chunk/route";

const TokenModal = dynamic(
  () => import("@/components/token-modal").then((m) => ({ default: m.TokenModal })),
  { ssr: false },
);

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

export default function ContributorsPageClient({ params }: Props) {
  const { owner, repo } = use(params);

  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [scan, dispatch] = useReducer(contributorsScanReducer, {
    points: [],
    unmapped: [],
    processed: 0,
  });
  const { points, unmapped } = scan;

  const [total, setTotal] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; login: string } | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => { setHasToken(!!getStoredToken()); }, []);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  const { status, error, startScraping, handleStartScan, handleTokenClose } = useContributorsScanController({
    owner,
    repo,
    dispatch,
    setTotal,
    setTokenOpen,
    setHasToken,
    ghHeaders,
  });

  const mapControlsRef = useRef<{ setViewMode: (m: "clusters" | "heatmap") => void } | null>(null);
  const [clusterRadius] = useState<number>(CLUSTER_RADIUS.default);

  const handleMapReady = useCallback(
    (controls: { setViewMode: (m: "clusters" | "heatmap") => void }) => {
      mapControlsRef.current = controls;
    },
    [],
  );

  // SAFETY: ContributorPoint is structurally compatible with StargazerPoint for map rendering.
  // contributions maps to followers via cast. context="contributors" tells the popup to render
  // "N commits" instead of "N followers".
  const allMapPoints = useMemo(
    () =>
      points.map((p) => ({
        login: p.login,
        name: p.login,
        bio: null,
        company: null,
        location: p.location,
        followers: p.contributions,
        avatarUrl: "",
        linkedinUrl: null,
        starredAt: "",
        lat: p.lat,
        lng: p.lng,
        context: "contributors",
        repoOwner: owner,
        repoRepo: repo,
      })) as unknown as StargazerPoint[],
    [points],
  );

  const isScanning = status === "loading" || status === "waiting" || status === "computing";
  const isDone = status === "done";

  // Auto-start scan on mount if token is already set (avoids manual click on revisit)
  useEffect(() => {
    if (getStoredToken()) startScraping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the panel the first time points arrive (points.length going 0→N)
  const panelAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (points.length > 0 && !panelAutoOpenedRef.current) {
      panelAutoOpenedRef.current = true;
      setPanelOpen(true);
    }
  }, [points.length]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Header
        sticky
        backLink={`/${owner}/${repo}`}
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      <main className="relative flex-1 overflow-hidden">
        <StargazerMapDynamic
          points={allMapPoints}
          flyTarget={flyTarget}
          onFlyDone={() => setFlyTarget(null)}
          onReady={handleMapReady}
          clusterRadius={clusterRadius}
          styleUrl={mapStyleUrl}
          showProjectionToggle
        />

        {/* Floating top bar */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 max-w-[90vw]">
          <div data-tour="contributors-controls" className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-lg">
            <span className="text-foreground text-sm font-medium whitespace-nowrap">
              {owner}/{repo} contributors
            </span>

            {/* Scan button (idle) */}
            {status === "idle" && (
              <button
                onClick={handleStartScan}
                className="flex items-center gap-1.5 bg-accent-green text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <GitCommit size={13} aria-hidden="true" />
                Map contributors
              </button>
            )}

            {/* Rescan button */}
            {isDone && (
              <button
                onClick={handleStartScan}
                className="flex items-center gap-1.5 border border-border text-muted text-xs px-2.5 py-1.5 rounded-md hover:text-foreground hover:border-accent-blue/50 transition-colors whitespace-nowrap"
                title="Refresh contributor data from GitHub"
              >
                Rescan
              </button>
            )}

            {/* Scanning progress */}
            {isScanning && (
              <div className="flex items-center gap-1.5 text-muted text-xs whitespace-nowrap">
                <Loader2 size={13} className="animate-spin text-accent-blue" aria-hidden="true" />
                {status === "waiting"
                  ? "Waiting for rate limit…"
                  : status === "computing"
                    ? "GitHub is computing stats…"
                    : "Scanning…"}
              </div>
            )}

            {/* Contributors count pill */}
            {(isDone || points.length > 0) && total > 0 && (
              <button
                data-tour="contributors-count"
                onClick={() => setPanelOpen(true)}
                className="flex items-center gap-1 bg-surface-alt border border-border rounded-md px-2 py-1 text-xs text-foreground hover:border-accent-blue/50 hover:text-accent-blue transition-colors whitespace-nowrap"
                aria-label={`${points.length.toLocaleString()} contributors mapped, open list`}
              >
                <GitCommit size={12} aria-hidden="true" />
                <span className="tabular-nums">{points.length.toLocaleString()}</span>
                <span className="text-muted-subtle">/ {total.toLocaleString()}</span>
              </button>
            )}

            {/* Error */}
            {status === "error" && error && (
              <span className="text-accent-red text-xs truncate max-w-48" role="alert">
                {error}
              </span>
            )}
          </div>
        </div>

        {/* Contributors side panel */}
        <div data-tour="contributors-panel">
          <ContributorsPanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            points={points}
            unmapped={unmapped}
            setFlyTarget={setFlyTarget}
          />
        </div>

        {/* Tour trigger */}
        <div className="absolute bottom-4 right-4 z-20">
          <TourTrigger
            tourId="contributors"
            label="Tour"
            className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded border border-border bg-surface/80 hover:border-accent-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 shadow"
          />
        </div>
      </main>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
