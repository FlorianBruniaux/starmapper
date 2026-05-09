// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import type { RepoOrganic } from "@/app/api/stats/[owner]/[repo]/route";

type Props = {
  open: boolean;
  onClose: () => void;
  organic: RepoOrganic;
  owner: string;
  repo: string;
  onRecalculated?: (organic: RepoOrganic) => void;
};

type SignalRow = {
  label: string;
  tooltip: string;
  rawValue: string;
  weight: string;
  signalScore: number | null;
  status: "ok" | "warn" | "na";
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const lerp = (v: number, lo: number, hi: number, outLo: number, outHi: number) =>
  outLo + ((v - lo) / (hi - lo)) * (outHi - outLo);

const clamp = (v: number) => Math.max(0, Math.min(100, v));

const normFork = (v: number) => {
  if (v >= 0.10) return 100;
  if (v <= 0.02) return 0;
  if (v >= 0.07) return clamp(lerp(v, 0.07, 0.10, 50, 100));
  return clamp(lerp(v, 0.02, 0.07, 0, 50));
};

const normWatcher = (v: number) => {
  if (v >= 0.005) return 100;
  if (v <= 0.0001) return 0;
  if (v >= 0.001) return clamp(lerp(v, 0.001, 0.005, 50, 100));
  return clamp(lerp(v, 0.0001, 0.001, 0, 50));
};

const normReleasesCount = (v: number): number => {
  if (v >= 100) return 100;
  if (v <= 0)   return 0;
  if (v >= 20)  return clamp(lerp(v, 20, 100, 60, 100));
  if (v >= 5)   return clamp(lerp(v, 5,  20,  30, 60));
  return clamp(lerp(v, 0, 5, 0, 30));
};

const buildSignals = (organic: RepoOrganic): SignalRow[] => {
  const { totalCount, forksCount, watchersCount, releasesCount } = organic;

  const FORK_TOOLTIP =
    "Repos with organic traction accumulate forks as developers build on them. " +
    "A very low fork/star ratio (< 2%) suggests stars weren't followed by real engagement. " +
    "Gated below 5 000 stars (signal too noisy on small repos).";

  const WATCHER_TOOLTIP =
    "GitHub watchers (\"Watch → All Activity\") are users who explicitly subscribe to repo notifications. " +
    "Since GitHub 2020, starring no longer auto-subscribes, so watchers represent genuinely interested users. " +
    "CLI/productivity tools structurally have fewer watchers (users install via Homebrew, never revisit GitHub).";

  const ZF_TOOLTIP =
    "Accounts with 0 followers are often newly-created bots used by star-farming services. " +
    "A healthy repo has < 10% zero-follower stargazers. " +
    "Computed from users StarMapper has enriched — requires sufficient sample size (≥ 30 users).";

  const RELEASES_TOOLTIP =
    "Repositories that ship regularly attract genuine users who follow development. " +
    "High release cadence (100+) → 100/100. Active projects (20–100) → 60–100. " +
    "Low cadence or no releases → penalised. Corrects bias against CLI/dev tools with low fork ratios.";

  const rows: SignalRow[] = [];

  if (forksCount !== null && totalCount > 0) {
    const ratio = forksCount / totalCount;
    const score = totalCount >= 5000 ? normFork(ratio) : null;
    rows.push({
      label: "Fork / star ratio",
      tooltip: FORK_TOOLTIP,
      rawValue: `${fmtPct(ratio)} · ${forksCount.toLocaleString()} forks / ${totalCount.toLocaleString()} ★`,
      weight: "30%",
      signalScore: score,
      status: totalCount < 5000 ? "na" : ratio >= 0.07 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Fork / star ratio",
      tooltip: FORK_TOOLTIP,
      rawValue: totalCount < 5000 ? "Gated — repo has < 5 000 stars" : "No data",
      weight: "30%",
      signalScore: null,
      status: "na",
    });
  }

  if (watchersCount !== null && totalCount > 0) {
    const ratio = watchersCount / totalCount;
    rows.push({
      label: "Watcher / star ratio",
      tooltip: WATCHER_TOOLTIP,
      rawValue: `${fmtPct(ratio)} · ${watchersCount.toLocaleString()} watchers`,
      weight: "5%",
      signalScore: normWatcher(ratio),
      status: ratio >= 0.005 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Watcher / star ratio",
      tooltip: WATCHER_TOOLTIP,
      rawValue: "No data",
      weight: "5%",
      signalScore: null,
      status: "na",
    });
  }

  rows.push({
    label: "Zero-follower stargazers",
    tooltip: ZF_TOOLTIP,
    rawValue: "Computed from enriched users in our DB",
    weight: "45%",
    signalScore: null,
    status: "ok",
  });

  if (releasesCount !== null) {
    const score = normReleasesCount(releasesCount);
    rows.push({
      label: "Releases cadence",
      tooltip: RELEASES_TOOLTIP,
      rawValue: `${releasesCount.toLocaleString()} total releases`,
      weight: "20%",
      signalScore: score,
      status: score >= 60 ? "ok" : score >= 30 ? "warn" : "warn",
    });
  } else {
    rows.push({
      label: "Releases cadence",
      tooltip: RELEASES_TOOLTIP,
      rawValue: "No data — click Recompute to fetch",
      weight: "20%",
      signalScore: null,
      status: "na",
    });
  }

  return rows;
};

const TIER_CONFIG: Record<string, { color: string; bg: string; bar: string; label: string }> = {
  healthy:      { color: "text-accent-green",  bg: "bg-accent-green/10",  bar: "bg-accent-green",  label: "Healthy" },
  moderate:     { color: "text-accent-orange",  bg: "bg-accent-orange-bg", bar: "bg-accent-orange", label: "Moderate" },
  suspicious:   { color: "text-accent-red",    bg: "bg-accent-red/10",    bar: "bg-accent-red",    label: "Suspicious" },
  insufficient: { color: "text-muted",         bg: "bg-surface-alt",      bar: "bg-muted",         label: "Insufficient data" },
};

const STATUS_COLOR: Record<string, string> = {
  ok:   "bg-accent-green",
  warn: "bg-accent-orange",
  na:   "bg-muted/40",
};

const SIGNAL_BAR_COLOR: Record<string, string> = {
  ok:   "bg-accent-green",
  warn: "bg-accent-orange",
  na:   "bg-muted/30",
};

export const OrganicScoreModal = ({ open, onClose, organic, owner, repo, onRecalculated }: Props) => {
  const [recalculating, setRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const signals = buildSignals(organic);
  const cfg = TIER_CONFIG[organic.tier] ?? TIER_CONFIG.insufficient;

  const handleRecalculate = async () => {
    setRecalculating(true);
    setRecalcError(null);
    try {
      const res = await fetch(`/api/organic-score/${owner}/${repo}/refresh`, { method: "POST" });
      if (res.status === 429) { setRecalcError("Rate limited — try again in 1 hour"); return; }
      if (!res.ok) { setRecalcError("Failed to recalculate — try again later"); return; }
      const data = await res.json() as { organic: RepoOrganic };
      onRecalculated?.(data.organic);
      onClose();
    } catch {
      setRecalcError("Network error — try again");
    } finally {
      setRecalculating(false);
    }
  };

  const disputeUrl = `https://github.com/fbruniaux/starmapper/issues/new?labels=score-dispute&title=${encodeURIComponent(`Score dispute: ${owner}/${repo}`)}&body=${encodeURIComponent(`**Repo:** ${owner}/${repo}\n**Score:** ${organic.score ?? "—"} (${organic.tier})\n\n**Reason:**\n<!-- Explain why you think this score is incorrect -->`)}`;

  const scoreVal = organic.score ?? 0;
  const scorePct = Math.min(100, Math.max(0, scoreVal));

  return (
    <Modal open={open} onClose={onClose} title="Organic Score" maxWidth="max-w-lg">
      <div className="px-5 py-4 space-y-4">

        {/* Score header */}
        <div className={`rounded-xl p-4 ${cfg.bg} border border-border-subtle`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-bold tabular-nums leading-none ${cfg.color}`}>
                {organic.score !== null ? organic.score : "—"}
              </span>
              <div>
                <div className={`text-base font-semibold ${cfg.color}`}>{cfg.label}</div>
                <div className="text-xs text-muted">out of 100</div>
              </div>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-orange-bg text-accent-orange border border-accent-orange-border text-2xs font-semibold uppercase tracking-wide">
              Experimental
            </span>
          </div>
          {/* Score bar */}
          <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
              style={{ width: `${scorePct}%` }}
            />
          </div>
        </div>

        {/* Signals */}
        <div className="space-y-3">
          {signals.map((s) => (
            <div key={s.label} className="group">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`size-1.5 rounded-full flex-shrink-0 ${STATUS_COLOR[s.status]}`} />
                  <span className="text-sm font-medium text-foreground truncate">{s.label}</span>
                  {/* Tooltip */}
                  <span className="relative inline-flex flex-shrink-0 group/tip">
                    <span className="text-muted hover:text-foreground cursor-help text-xs leading-none">ⓘ</span>
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal">
                      {s.tooltip}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.signalScore !== null && (
                    <span className={`text-xs font-semibold tabular-nums ${s.status === "ok" ? "text-accent-green" : s.status === "warn" ? "text-accent-orange" : "text-muted"}`}>
                      {Math.round(s.signalScore)}/100
                    </span>
                  )}
                  <span className="text-2xs text-muted border border-border-subtle rounded px-1.5 py-0.5 tabular-nums font-medium">
                    w {s.weight}
                  </span>
                </div>
              </div>
              {/* Signal bar */}
              <div className="ml-3 mb-1 h-1 w-full bg-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${SIGNAL_BAR_COLOR[s.status]}`}
                  style={{ width: s.signalScore !== null ? `${s.signalScore}%` : s.status === "na" ? "0%" : "50%" }}
                />
              </div>
              <p className="ml-3 text-xs text-muted">{s.rawValue}</p>
            </div>
          ))}
        </div>

        {/* Activity + Release row */}
        {(organic.openIssuesCount !== null || organic.latestReleaseTag) && (() => {
          const issuesOnlyCount =
            organic.openIssuesCount !== null && organic.openPRsCount !== null
              ? organic.openIssuesCount - organic.openPRsCount
              : organic.openIssuesCount;
          return (
            <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
              {/* Issues counter — split view */}
              {issuesOnlyCount !== null && organic.openPRsCount !== null && (
                <a
                  href={`https://github.com/${owner}/${repo}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-alt rounded-md px-2.5 py-1.5 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                >
                  <svg className="size-3.5 text-muted flex-shrink-0" fill="none" viewBox="0 0 16 16"
                    stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.25"/>
                    <path d="M8 5v3.5M8 11v.5" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {issuesOnlyCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted">issues</span>
                </a>
              )}
              {/* PRs counter */}
              {organic.openPRsCount !== null && (
                <a
                  href={`https://github.com/${owner}/${repo}/pulls`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-alt rounded-md px-2.5 py-1.5 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                >
                  <svg className="size-3.5 text-muted flex-shrink-0" fill="none" viewBox="0 0 16 16"
                    stroke="currentColor" strokeWidth="1.5">
                    <circle cx="4" cy="4" r="1.75"/>
                    <circle cx="12" cy="12" r="1.75"/>
                    <circle cx="12" cy="4" r="1.75"/>
                    <path d="M4 5.75v4.5M12 5.75v2.5a2 2 0 01-2 2H7" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {organic.openPRsCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted">open PRs</span>
                </a>
              )}
              {/* Fallback combiné si pas de split */}
              {organic.openIssuesCount !== null && organic.openPRsCount === null && (
                <a
                  href={`https://github.com/${owner}/${repo}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-alt rounded-md px-2.5 py-1.5 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                >
                  <svg className="size-3.5 text-muted flex-shrink-0" fill="none" viewBox="0 0 16 16"
                    stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.25"/>
                    <path d="M8 5v3.5M8 11v.5" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {organic.openIssuesCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted">issues & PRs</span>
                </a>
              )}
              {/* Version + date */}
              {organic.latestReleaseTag && organic.latestReleaseUrl && (
                <a
                  href={organic.latestReleaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-surface-alt rounded-md px-2.5 py-1.5 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                >
                  <svg className="size-3.5 text-muted flex-shrink-0" fill="none" viewBox="0 0 16 16"
                    stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 2l1.5 3 3.5.5-2.5 2.5.5 3.5L8 10l-3 1.5.5-3.5L3 5.5 6.5 5z"
                      strokeLinejoin="round"/>
                  </svg>
                  <span className="text-sm font-semibold text-foreground">{organic.latestReleaseTag}</span>
                  {organic.latestReleaseAt && (
                    <span className="text-xs text-muted">
                      ({new Date(organic.latestReleaseAt).toLocaleDateString()})
                    </span>
                  )}
                </a>
              )}
            </div>
          );
        })()}

        {/* Disclaimer */}
        <p className="text-xs text-muted/80 leading-relaxed border-t border-border-subtle pt-3">
          Heuristic based on 4 public signals, not an accusation of fraud.
          Repos with viral growth or niche communities may score lower despite being organic.
          {organic.computedAt && (
            <>{" "}<span className="text-muted/60">Computed {new Date(organic.computedAt).toLocaleDateString()}.</span></>
          )}
        </p>

        {/* Footer: actions + links */}
        <div className="border-t border-border-subtle pt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              title="Re-fetch live data from GitHub and recompute (1× per hour)"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors disabled:opacity-50"
            >
              {recalculating ? (
                <>
                  <svg className="size-3 animate-spin" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                    <path d="M8 2a6 6 0 100 12A6 6 0 008 2z" strokeDasharray="20" strokeDashoffset="15"/>
                  </svg>
                  Recalculating…
                </>
              ) : (
                <>
                  <svg className="size-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 8a5 5 0 005 5 5 5 0 004.33-2.5M13 8a5 5 0 00-5-5 5 5 0 00-4.33 2.5" strokeLinecap="round"/>
                    <path d="M11 2.5L13 5l-2.5 1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Recompute
                </>
              )}
            </button>
            <span className="text-border-subtle select-none">·</span>
            <a
              href={disputeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Dispute or request removal →
            </a>
            {recalcError && (
              <span className="text-xs text-accent-red">{recalcError}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <a
              href="https://arxiv.org/abs/2412.13459"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue/70 hover:text-accent-blue transition-colors"
            >
              CMU/StarScout paper
            </a>
            <span className="text-muted/40">·</span>
            <a
              href="/organic-score/calibration"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue/70 hover:text-accent-blue transition-colors"
            >
              Calibration data
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
};
