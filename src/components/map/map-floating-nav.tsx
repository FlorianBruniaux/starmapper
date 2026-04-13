// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { MapProjection } from "@/lib/theme";

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
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="hidden sm:block shrink-0" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.56 7.25h8.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 0 1 0 1.06Z" />
          </svg>
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
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5V5a5 5 0 0 0 4.797 4.994A4.001 4.001 0 0 0 8 13.277V14H5.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5H8v-.723a4.001 4.001 0 0 0 2.203-3.283A5 5 0 0 0 15 5V3.5A1.5 1.5 0 0 0 13.5 2h-11Zm11 1.5V5a3.5 3.5 0 0 1-2.81 3.441A4.005 4.005 0 0 0 11 7V3.5h2.5Zm-10 0H5V7a4.005 4.005 0 0 0 .31 1.441A3.5 3.5 0 0 1 2.5 5V3.5Z" />
          </svg>
          <span className="hidden sm:inline">Leaderboard</span>
        </Link>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <button
          onClick={onTokenClick}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            hasToken ? "text-accent-green" : "text-muted hover:text-foreground"
          }`}
          title={hasToken ? "Token set" : "Add GitHub token"}
          aria-label={hasToken ? "GitHub token set" : "Add GitHub token"}
        >
          {hasToken ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z" />
            </svg>
          )}
          <span className="hidden sm:inline">{hasToken ? "Token set" : "Add token"}</span>
        </button>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <button
          onClick={onProjectionToggle}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
          title={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
          aria-label={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
        >
          {projection === "globe" ? (
            /* Flat icon — active when globe, click → flat */
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="1" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="9" y1="6" x2="9" y2="18" />
              <line x1="15" y1="6" x2="15" y2="18" />
            </svg>
          ) : (
            /* Globe icon — active when flat, click → globe */
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="3.5" ry="9" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          )}
          <span className="hidden sm:inline">{projection === "globe" ? "2D" : "3D"}</span>
        </button>
        <div className="w-px h-3.5 bg-border-subtle" aria-hidden="true" />
        <ThemeToggle />
      </div>
    </div>
  </>
);
