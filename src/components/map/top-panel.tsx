// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { TimeEstimate } from "@/lib/format";
import { formatEstimate, timeAgo } from "@/lib/format";
import { isCountry, normalizeCountry } from "@/lib/countries";

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
};

export const TopPanel = ({
  owner, repo, repoInfo,
  compareOwner, compareRepo, compareInfo, compareStatus, comparePoints,
  points, total, unmapped, setDrawerOpen,
  status, pct, retryIn, processed, estimate,
  cachedAt, latestStarredAt, startRefresh, newStarsCount, handleStartScan, hasToken,
  storedUsername, onSetUsername, findMe,
  error,
  findInput, setFindInput, setFindStatus, findUser, findStatus,
}: Props) => {
  const [askingUsername, setAskingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const mappingPct = total > 0 ? Math.round((points.length / total) * 100) : 0;
  const locationCount = new Set(
    points
      .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
      .filter(Boolean),
  ).size;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10
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
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          Search
        </a>

        {/* Repo identity — centré naturellement avec flex-1 */}
        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
          {repoInfo?.avatar && (
            <img src={repoInfo.avatar} alt="" width={20} height={20} className="size-5 rounded-full flex-shrink-0" />
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

        {/* Spacer symétrique pour garder le repo centré */}
        <div className="w-14 flex-shrink-0" />
      </div>

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
        <div className="grid grid-cols-3 divide-x divide-border-subtle">
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
              {total.toLocaleString() || "—"}
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
        </div>

        {/* No location row — séparé, visuellement déprioritisé */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="w-full flex items-center justify-between px-3 py-1.5
            bg-surface-alt/50 hover:bg-surface-alt transition-colors
            border-t border-border-subtle group"
        >
          <span className="text-2xs text-muted-subtle uppercase tracking-wide">
            No location
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-subtle tabular-nums">
              {unmapped.length.toLocaleString()}
            </span>
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className="text-muted-subtle group-hover:text-muted transition-colors"
            >
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </div>
        </button>
      </div>

      {/* ── Progress bar — during scan ────────────────────────────────────── */}
      {(status === "loading" || status === "refreshing" || status === "waiting") && (
        <div className="mt-2.5">
          <div className="w-full bg-surface-alt rounded-full h-1 overflow-hidden">
            <div
              className="bg-accent-blue h-full rounded-full transition-all duration-300"
              style={{ width: status === "refreshing" ? "100%" : `${pct}%` }}
            />
          </div>
          <div className="text-2xs text-muted mt-1 text-center">
            {status === "waiting"
              ? `⏸ Queued — resuming in ${retryIn}s…`
              : status === "refreshing"
              ? "↻ Fetching new stars…"
              : `Fetching ${processed.toLocaleString()} / ${total.toLocaleString()} — ${pct}%`
            }
            {estimate && status === "loading" && (
              <span className="ml-1 text-muted-subtle">· est. {formatEstimate(estimate)}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Mapping ratio bar — after scan ───────────────────────────────── */}
      {(status === "cached" || status === "done") && total > 0 && points.length > 0 && (
        <div className="mt-2.5">
          <div className="w-full bg-surface-alt rounded-full h-1 overflow-hidden">
            <div
              className="bg-accent-blue h-full rounded-full transition-all duration-500"
              style={{ width: `${mappingPct}%` }}
            />
          </div>
          <div className="text-2xs text-muted-subtle mt-0.5 text-center">
            {points.length.toLocaleString()} / {total.toLocaleString()} mapped ({mappingPct}%)
          </div>
        </div>
      )}

      {/* ── Cache status ──────────────────────────────────────────────────── */}
      {(status === "cached" || status === "done") && cachedAt && (
        <div className="mt-2 pt-2 border-t border-border-subtle
          flex items-center justify-between gap-2">
          <span className="text-2xs text-accent-green flex items-center gap-1">
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            {status === "done" ? "Indexed" : `Cached ${timeAgo(cachedAt)}`}
          </span>
          <div className="flex items-center gap-2">
            {status === "cached" && latestStarredAt && (
              <button
                onClick={startRefresh}
                className="text-2xs text-accent-blue hover:underline flex items-center gap-1"
              >
                {!hasToken && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
                ↻ {newStarsCount > 0 ? `${newStarsCount} new stars` : "Refresh"}
              </button>
            )}
            <button
              onClick={handleStartScan}
              className="text-2xs text-muted-subtle hover:text-muted transition-colors flex items-center gap-1"
            >
              {!hasToken && (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              )}
              Full rescan
            </button>
          </div>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {status === "error" && error && (
        <div className="mt-2 text-accent-red text-xs">{error}</div>
      )}

      {/* ── Find a stargazer ──────────────────────────────────────────────── */}
      <div className="mt-2.5 pt-2.5 border-t border-border-subtle">
        <div className="relative flex items-center">
          {/* Loupe inline dans le field */}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-3 text-muted-subtle pointer-events-none"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={findInput}
            onChange={(e) => { setFindInput(e.target.value); setFindStatus("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") findUser(); }}
            placeholder="Find a stargazer…"
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
        {findStatus === "found" && (
          <p className="mt-1.5 text-2xs text-accent-green flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5"/>
            </svg>
            Found — flying to location
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

        {/* ── Find me shortcut ──────────────────────────────────────────── */}
        <div className="mt-2 pt-2 border-t border-border-subtle">
          {storedUsername && !askingUsername ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={findMe}
                className="text-2xs text-accent-blue hover:underline flex items-center gap-1 flex-shrink-0"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
                </svg>
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
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
              </svg>
              Set my username for quick Find me
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
