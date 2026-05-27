// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";
import { ArrowLeft, Check, Clock, Trophy, Globe, Map } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { MapProjection } from "@/lib/theme";
import { TourTrigger } from "@/components/tour/tour-trigger";

const pillCls =
  "flex items-center gap-2 bg-surface/90 backdrop-blur-md border border-border rounded-full px-3 py-1.5 shadow-sm";

type Props = {
  owner: string;
  repo: string;
  hasToken: boolean;
  onTokenClick: () => void;
  projection: MapProjection;
  onProjectionToggle: () => void;
};

export const MapFloatingNav = ({ owner, repo, hasToken, onTokenClick, projection, onProjectionToggle }: Props) => (
  <>
    {/* Top-left pill: back + repo identity */}
    <div className="absolute top-3 left-3 z-20">
      <div className={pillCls}>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors"
          aria-label="Back to StarMapper"
        >
          {/* Globe logo */}
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-accent-blue shrink-0">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
            <ellipse cx="10" cy="10" rx="4" ry="8" stroke="currentColor" strokeWidth="1.25"/>
            <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.25"/>
            <path d="M3.5 6.5 Q10 5 16.5 6.5" stroke="currentColor" strokeWidth="1" fill="none"/>
            <path d="M3.5 13.5 Q10 15 16.5 13.5" stroke="currentColor" strokeWidth="1" fill="none"/>
            <path d="M10 5.5 L10.6 7.4 L12.6 7.4 L11.0 8.6 L11.6 10.5 L10 9.3 L8.4 10.5 L9.0 8.6 L7.4 7.4 L9.4 7.4 Z" fill="currentColor"/>
          </svg>
          {/* Back arrow — visible only on sm+ */}
          <ArrowLeft size={12} className="hidden sm:block shrink-0" aria-hidden="true" />
        </Link>
        {/* Separator */}
        <span className="text-border-subtle select-none hidden sm:block" aria-hidden="true">/</span>
        {/* Repo name */}
        <span className="text-foreground text-xs font-medium max-w-[40vw] truncate hidden sm:block">
          {owner}/{repo}
        </span>
      </div>
    </div>

    {/* Top-right pill: Explore + Token + Theme */}
    <div className="absolute top-3 right-3 z-20">
      <div className={pillCls}>
        <Link
          href="/explore"
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          <Trophy size={12} aria-hidden="true" />
          <span className="hidden sm:inline">Leaderboard</span>
        </Link>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <button
          onClick={onTokenClick}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            hasToken ? "text-accent-green" : "text-muted hover:text-foreground"
          }`}
          title={hasToken ? "Token set" : "Faster scans: add a free GitHub token"}
          aria-label={hasToken ? "GitHub token set" : "Add a free GitHub token for faster scans"}
        >
          {hasToken ? (
            <Check size={12} aria-hidden="true" />
          ) : (
            <Clock size={12} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{hasToken ? "Token set" : "Faster scans"}</span>
        </button>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <button
          data-tour="map-projection"
          onClick={onProjectionToggle}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
          title={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
          aria-label={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
        >
          {projection === "globe" ? (
            /* Flat icon — active when globe, click → flat */
            <Map size={12} aria-hidden="true" />
          ) : (
            /* Globe icon — active when flat, click → globe */
            <Globe size={12} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{projection === "globe" ? "2D" : "3D"}</span>
        </button>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <TourTrigger
          tourId="map"
          label=""
          className="flex items-center text-xs text-muted hover:text-foreground transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
        />
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <ThemeToggle />
      </div>
    </div>
  </>
);
