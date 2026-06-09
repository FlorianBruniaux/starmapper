// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { memo, useMemo, useState } from "react";
import { Search, ChevronRight, ChevronUp, ChevronDown, Check, Lock, User, Info } from "lucide-react";
import Image from "next/image";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { TimeEstimate } from "@/lib/format";
import { formatEstimate, timeAgo } from "@/lib/format";
import { isCountry, normalizeCountry } from "@/lib/countries";
import type { RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";
import { OrganicScorePill } from "@/components/organic-score-pill";
import { OrganicScoreModal } from "@/components/organic-score-modal";

const ORGANIC_ENABLED = process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED === "true";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  avatar: string | null;
};

type FindStatus = "idle" | "searching" | "found" | "no-location" | "not-found";

type ScanStatus = "idle" | "loading" | "waiting" | "done" | "cached" | "refreshing" | "error";

type UnmappedUser = {
  login: string;
  name: string | null;
  followers: number;
  starredAt: string | null;
};

type Props = {
  owner: string;
  repo: string;
  repoInfo: RepoInfo | null;
  compareOwner: string | null;
  compareRepo: string | null;
  compareInfo: RepoInfo | null;
  compareStatus: "idle" | "loading" | "done";
  comparePoints: StargazerPoint[];
  points: StargazerPoint[];
  total: number;
  unmapped: UnmappedUser[];
  setDrawerOpen: (v: boolean) => void;
  status: ScanStatus;
  pct: number;
  retryIn: number;
  processed: number;
  estimate: TimeEstimate | null;
  cachedAt: number | null;
  latestStarredAt: string | null;
  startRefresh: () => void;
  newStarsCount: number;
  handleStartScan: () => void;
  hasToken: boolean;
  storedUsername: string;
  onSetUsername: (v: string) => void;
  findMe: () => void;
  error: string | null;
  findInput: string;
  setFindInput: (v: string) => void;
  setFindStatus: (v: FindStatus) => void;
  findUser: () => void;
  findStatus: FindStatus;
  organic?: RepoOrganic | null;
};

const TopPanelInner = ({
  owner, repo, repoInfo,
  compareOwner, compareRepo, compareInfo, compareStatus, comparePoints,
  points, total, unmapped, setDrawerOpen,
  status, pct, retryIn, processed, estimate,
  cachedAt, latestStarredAt, startRefresh, newStarsCount, handleStartScan, hasToken,
  storedUsername, onSetUsername, findMe,
  error,
  findInput, setFindInput, setFindStatus, findUser, findStatus,
  organic,
}: Props) => {
  const [collapsed, setCollapsed] = useState(false);
  const [askingUsername, setAskingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [organicModalOpen, setOrganicModalOpen] = useState(false);
  const [organicOverride, setOrganicOverride] = useState<RepoOrganic | null>(null);
  const activeOrganic = organicOverride ?? organic ?? null;
  const showOrganic = ORGANIC_ENABLED && total > 0;
  const displayTotal = repoInfo?.stars ?? total;
  const mappingPct = displayTotal > 0 ? Math.round((points.length / displayTotal) * 100) : 0;
  const locationCount = useMemo(() => new Set(
    points
      .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
      .filter(Boolean),
  ).size, [points]);

  return (
    <>
    <div data-tour="map-top-panel" className="absolute top-4 left-1/2 -translate-x-1/2 z-10
      bg-background/90 border border-border rounded-xl
      px-4 py-3 backdrop-blur-md shadow-2xl min-w-80 w-max max-w-sm">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {/* "Another repo" pill — ghost, discret, à gauche */}
        <a
          href="/"
          title="Map another repo"
          className="flex items-center gap-1 text-2xs text-muted hover:text-foreground
            border border-border-subtle rounded-full px-2 py-0.5
            hover:border-border transition-colors flex-shrink-0"
        >
          <Search size={10} aria-hidden="true" />
          Search
        </a>

        {/* Repo identity — centré naturellement avec flex-1 */}
        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
          {repoInfo?.avatar && (
            <Image src={repoInfo.avatar} alt="" width={20} height={20} className="size-5 rounded-full flex-shrink-0" />
          )}
          <a
            href={`https://github.com/${owner}/${repo}`}
            target="_blank"
            className="text-foreground text-sm font-semibold hover:text-accent-blue
              transition-colors truncate"
          >
            {owner}/{repo}
          </a>
        </div>

        {/* Collapse toggle — symétrique avec Search pill à gauche */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          className="flex items-center gap-1 text-2xs text-muted hover:text-foreground
            border border-border-subtle rounded-full px-2 py-0.5
            hover:border-border transition-colors flex-shrink-0"
        >
          {collapsed ? <ChevronDown size={10} aria-hidden="true" /> : <ChevronUp size={10} aria-hidden="true" />}
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {/* ── Collapsible body ──────────────────────────────────────────────── */}
      {!collapsed && (<>

      {/* ── Compare row ───────────────────────────────────────────────────── */}
      {compareOwner && compareRepo && (
        <div className="mt-1.5 flex items-center justify-center gap-2 text-2xs">
          <span className="inline-block size-2 rounded-full bg-accent-purple flex-shrink-0" />
          <span className="text-muted">
            vs <span className="text-accent-purple">{compareOwner}/{compareRepo}</span>
            {compareInfo && (
              <span className="text-muted-subtle ml-1">
                ({compareInfo.stars.toLocaleString()} ★)
              </span>
            )}
            {compareStatus === "loading" && (
              <span className="text-muted-subtle ml-1">· scanning…</span>
            )}
            {compareStatus === "done" && (
              <span className="text-muted-subtle ml-1">· {comparePoints.length} mapped</span>
            )}
          </span>
        </div>
      )}

      {/* ── Stats grid ────────────────────────────────────────────────────── */}
      <div className="mt-3 border border-border-subtle rounded-lg overflow-hidden">
        <div className={`grid divide-x divide-border-subtle ${showOrganic ? "grid-cols-4" : "grid-cols-3"}`}>
          {/* Mapped */}
          <div className="flex flex-col items-center py-2 px-3">
            <div className="text-xl font-bold text-foreground tabular-nums leading-tight">
              {points.length.toLocaleString()}
            </div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">Mapped</div>
          </div>

          {/* Total stars */}
          <div className="flex flex-col items-center py-2 px-3">
            <div className="text-xl font-bold text-foreground tabular-nums leading-tight">
              {(repoInfo?.stars ?? total).toLocaleString() || "—"}
            </div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">Stars</div>
          </div>

          {/* Locations */}
          <div className="flex flex-col items-center py-2 px-3">
            <div className="text-xl font-bold text-foreground tabular-nums leading-tight">
              {locationCount.toString()}
            </div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">Countries</div>
          </div>

          {/* Organic score tile — pending pill when no data, score pill when computed */}
          {showOrganic && (
            <div className="flex flex-col items-center py-2 px-3">
              {activeOrganic ? (
                <OrganicScorePill
                  score={activeOrganic.score}
                  tier={activeOrganic.tier}
                  onClick={() => setOrganicModalOpen(true)}
                />
              ) : (
                <OrganicScorePill pending totalStars={total} />
              )}
              <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">Organic</div>
            </div>
          )}
        </div>

        {/* No location row — séparé, visuellement déprioritisé */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="w-full flex items-center justify-between px-3 py-1.5
            bg-surface-alt/50 hover:bg-surface-alt transition-colors
            border-t border-border-subtle group"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-muted-subtle uppercase tracking-wide">
              Hidden from map
            </span>
            <span className="relative group/tip">
              <Info size={9} className="text-muted-subtle opacity-60" aria-hidden="true" />
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
                These stargazers are fully indexed but haven&apos;t set a location in their GitHub profile, so they can&apos;t be placed on the map.
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-subtle tabular-nums">
              {unmapped.length.toLocaleString()}
            </span>
            <ChevronRight size={10} className="text-muted-subtle group-hover:text-muted transition-colors" aria-hidden="true" />
          </div>
        </button>
      </div>

      {/* ── Progress bar — during scan ────────────────────────────────────── */}
      {(status === "loading" || status === "refreshing" || status === "waiting") && (
        <div className="mt-2.5">
          <div
            className="w-full bg-surface-alt rounded-full h-1 overflow-hidden"
            role="progressbar"
            aria-valuenow={status === "refreshing" ? 100 : pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Scan progress"
          >
            <div
              className="bg-accent-blue h-full rounded-full transition-all duration-300"
              style={{ width: status === "refreshing" ? "100%" : `${pct}%` }}
            />
          </div>
          <div className="text-2xs text-muted mt-1 text-center">
            {status === "waiting"
              ? `⏸ Queued, resuming in ${retryIn}s…`
              : status === "refreshing"
              ? "↻ Fetching new stars…"
              : `Fetching ${processed.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`
            }
            {estimate && status === "loading" && (
              <span className="ml-1 text-muted-subtle">· est. {formatEstimate(estimate)}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Location coverage bar — after scan ──────────────────────────── */}
      {(status === "cached" || status === "done") && total > 0 && points.length > 0 && (
        <div className="mt-2.5">
          <div
            className="w-full bg-surface-alt rounded-full h-1 overflow-hidden"
            role="meter"
            aria-valuenow={mappingPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Location coverage"
          >
            <div
              className="bg-accent-green h-full rounded-full transition-all duration-500"
              style={{ width: `${mappingPct}%` }}
            />
          </div>
          <div className="text-2xs text-muted-subtle mt-0.5 text-center flex items-center justify-center gap-1">
            <span>
              {mappingPct}% have a GitHub location ({points.length.toLocaleString()} of {displayTotal.toLocaleString()})
            </span>
            <span className="relative group/tip">
              <Info size={9} className="opacity-60" aria-hidden="true" />
              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
                All {displayTotal.toLocaleString()} stargazers are indexed. Only those who&apos;ve set a location in their GitHub profile can be placed on the map.
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ── Cache status ──────────────────────────────────────────────────── */}
      {(status === "cached" || status === "done") && cachedAt && (
        <>
        <div className="mt-2 pt-2 border-t border-border-subtle
          flex items-center justify-between gap-2">
          <span className="text-2xs text-accent-green flex items-center gap-1">
            <Check size={10} aria-hidden="true" />
            {status === "done" ? "Indexed" : `Cached ${timeAgo(cachedAt)}`}
          </span>
          <div className="flex items-center gap-2">
            {status === "cached" && latestStarredAt && (
              <button
                onClick={startRefresh}
                className="text-2xs text-accent-blue hover:underline flex items-center gap-1"
              >
                {!hasToken && (
                  <span className="relative group/tip">
                    <Lock size={9} className="opacity-60" aria-hidden="true" />
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
                      Add a free GitHub token for faster scanning. No login needed.
                    </span>
                  </span>
                )}
                ↻ {newStarsCount > 0 ? `${newStarsCount} new stars` : "Refresh"}
              </button>
            )}
            <button
              onClick={handleStartScan}
              className="text-2xs text-muted-subtle hover:text-muted transition-colors flex items-center gap-1"
            >
              {!hasToken && (
                <span className="relative group/tip">
                  <Lock size={9} className="opacity-60" aria-hidden="true" />
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
                    Add a free GitHub token for faster scanning. No login needed.
                  </span>
                </span>
              )}
              Full rescan
            </button>
          </div>
        </div>
        <p className="text-2xs text-muted-subtle mt-1 text-center leading-relaxed">
          Data updates when someone refreshes, not in real time.
          {!hasToken && " Add a token to refresh yourself."}
        </p>
        </>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {status === "error" && error && (
        <div className="mt-2 text-accent-red text-xs">{error}</div>
      )}

      {/* ── Find a stargazer ──────────────────────────────────────────────── */}
      <div data-tour="map-find-stargazer" className="mt-2.5 pt-2.5 border-t border-border-subtle">
        <div className="relative flex items-center">
          {/* Loupe inline dans le field */}
          <Search size={12} className="absolute left-3 text-muted-subtle pointer-events-none" aria-hidden="true" />
          <input
            value={findInput}
            onChange={(e) => { setFindInput(e.target.value); setFindStatus("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") findUser(); }}
            placeholder="Find a stargazer…"
            aria-label="Find a stargazer"
            className="flex-1 bg-surface border border-border rounded-lg
              pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-subtle
              focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30
              transition-colors"
          />
          <button
            onClick={() => findUser()}
            disabled={findStatus === "searching"}
            className="ml-2 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
              bg-surface-alt border border-border text-muted
              hover:text-foreground hover:border-accent-blue/50
              disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {findStatus === "searching" ? (
              <>
                <svg className="animate-spin size-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10"
                    stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Searching
              </>
            ) : "Find"}
          </button>
        </div>

        {/* Find feedback */}
        <div aria-live="polite" role="status">
          {findStatus === "found" && (
            <p className="mt-1.5 text-2xs text-accent-green flex items-center gap-1">
              <Check size={10} aria-hidden="true" />
              Found, flying to location
            </p>
          )}
          {findStatus === "no-location" && (
            <p className="mt-1.5 text-2xs text-accent-orange">
              Starred but has no location set on GitHub
            </p>
          )}
          {findStatus === "not-found" && (
            <p className="mt-1.5 text-2xs text-accent-red">
              Not found in stargazers
            </p>
          )}
        </div>

        {/* ── Find me shortcut ──────────────────────────────────────────── */}
        <div className="mt-2 pt-2 border-t border-border-subtle">
          {storedUsername && !askingUsername ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={findMe}
                className="text-2xs text-accent-blue hover:underline flex items-center gap-1 flex-shrink-0"
              >
                <User size={10} aria-hidden="true" />
                Find me
              </button>
              <span className="text-2xs text-muted-subtle truncate">@{storedUsername}</span>
              <button
                onClick={() => { onSetUsername(""); setAskingUsername(false); }}
                className="ml-auto text-muted-subtle hover:text-muted text-xs leading-none flex-shrink-0"
                title="Clear my username"
              >
                ×
              </button>
            </div>
          ) : askingUsername ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = usernameInput.trim();
                if (v) { onSetUsername(v); setAskingUsername(false); setUsernameInput(""); }
              }}
              className="flex items-center gap-1.5"
            >
              <input
                autoFocus
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Your GitHub username…"
                aria-label="Your GitHub username"
                className="flex-1 bg-surface border border-border rounded-md px-2 py-1 text-xs
                  text-foreground placeholder:text-muted-subtle
                  focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30
                  min-w-0"
              />
              <button
                type="submit"
                className="text-2xs px-2 py-1 rounded-md bg-accent-blue/10 text-accent-blue
                  border border-accent-blue/30 hover:bg-accent-blue/20 transition-colors flex-shrink-0"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setAskingUsername(false); setUsernameInput(""); }}
                className="text-muted-subtle hover:text-muted text-xs leading-none flex-shrink-0"
              >
                ×
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAskingUsername(true)}
              className="text-2xs text-muted-subtle hover:text-muted transition-colors flex items-center gap-1"
            >
              <User size={10} aria-hidden="true" />
              Set my username for quick Find me
            </button>
          )}
        </div>
      </div>

      </>)}
    </div>

    {/* Organic score detail modal */}
    {showOrganic && activeOrganic && (
      <OrganicScoreModal
        open={organicModalOpen}
        onClose={() => setOrganicModalOpen(false)}
        organic={activeOrganic}
        owner={owner}
        repo={repo}
        onRecalculated={setOrganicOverride}
      />
    )}
    </>
  );
};

export const TopPanel = memo(TopPanelInner);
