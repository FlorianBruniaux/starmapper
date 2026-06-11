// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { AlertCircle, GitPullRequest, Star, RefreshCw } from "lucide-react";
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

const normContributorsRatio = (count: number, stars: number): number => {
  const ratio = (count / stars) * 1000;
  if (ratio >= 3.0) return 100;
  if (ratio <= 0.2) return 0;
  if (ratio >= 2.0) return clamp(lerp(ratio, 2.0, 3.0, 80, 100));
  if (ratio >= 1.0) return clamp(lerp(ratio, 1.0, 2.0, 50, 80));
  if (ratio >= 0.5) return clamp(lerp(ratio, 0.5, 1.0, 25, 50));
  return clamp(lerp(ratio, 0.2, 0.5, 0, 25));
};

const buildSignals = (organic: RepoOrganic): SignalRow[] => {
  const { totalCount, forksCount, watchersCount, releasesCount, contributorsCount } = organic;

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
    "Computed from users StarMapper has enriched. Requires sufficient sample size (≥ 30 users).";

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
      weight: "25%",
      signalScore: score,
      status: totalCount < 5000 ? "na" : ratio >= 0.07 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Fork / star ratio",
      tooltip: FORK_TOOLTIP,
      rawValue: totalCount < 5000 ? "Gated (repo has < 5 000 stars)" : "No data",
      weight: "25%",
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
      weight: "15%",
      signalScore: score,
      status: score >= 60 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Releases cadence",
      tooltip: RELEASES_TOOLTIP,
      rawValue: "No data. Click Recompute to fetch.",
      weight: "15%",
      signalScore: null,
      status: "na",
    });
  }

  const CONTRIBUTORS_TOOLTIP =
    "Repos with broad community adoption accumulate contributors over time. " +
    "Measured as contributors per 1 000 stars — normalises for repo size. " +
    "A very low ratio on a large repo suggests star farming without genuine engagement. " +
    "Gated below 5 000 stars (signal too noisy on small repos).";

  if (contributorsCount !== null && contributorsCount > 0 && totalCount >= 5000) {
    const score = normContributorsRatio(contributorsCount, totalCount);
    rows.push({
      label: "Contributors / 1k stars",
      tooltip: CONTRIBUTORS_TOOLTIP,
      rawValue: `${contributorsCount.toLocaleString()} contributors · ${((contributorsCount / totalCount) * 1000).toFixed(1)}/1k ★`,
      weight: "10%",
      signalScore: score,
      status: score >= 50 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Contributors / 1k stars",
      tooltip: CONTRIBUTORS_TOOLTIP,
      rawValue: contributorsCount === null
        ? "No data. Click Recompute to fetch."
        : totalCount < 5000
          ? "Gated (repo has < 5 000 stars)"
          : "No contributors data",
      weight: "10%",
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
      if (res.status === 429) { setRecalcError("Rate limited. Try again in 1 hour."); return; }
      if (!res.ok) { setRecalcError("Failed to recalculate. Try again later."); return; }
      const data = await res.json() as { organic: RepoOrganic };
      onRecalculated?.(data.organic);
      onClose();
    } catch {
      setRecalcError("Network error. Try again.");
    } finally {
      setRecalculating(false);
    }
  };

  const disputeUrl = `https://github.com/fbruniaux/starmapper/issues/new?labels=score-dispute&title=${encodeURIComponent(`Score dispute: ${owner}/${repo}`)}&body=${encodeURIComponent(`**Repo:** ${owner}/${repo}\n**Score:** ${organic.score ?? "—"} (${organic.tier})\n\n**Reason:**\n<!-- Explain why you think this score is incorrect -->`)}`;

  const scoreVal = organic.score ?? 0;
  const scorePct = Math.min(100, Math.max(0, scoreVal));

  const issuesOnlyCount =
    organic.openIssuesCount !== null && organic.openPRsCount !== null
      ? organic.openIssuesCount - organic.openPRsCount
      : organic.openIssuesCount;

  const hasActivity = organic.openIssuesCount !== null || organic.latestReleaseTag;

  return (
    <Modal open={open} onClose={onClose} title="Organic Score" maxWidth="max-w-2xl">
      <div className="px-6 py-5">

        {/* Two-column layout: signals on left, sidebar on right */}
        <div className="flex flex-col sm:flex-row gap-5">

          {/* ── Left column: score header + signals ── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Score header */}
            <div className={`rounded-xl p-4 ${cfg.bg} border border-border-subtle`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-baseline gap-3">
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
              <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
                  style={{ width: `${scorePct}%` }}
                />
              </div>
            </div>

            {/* Signal rows */}
            <div className="space-y-2.5">
              {signals.map((s) => (
                <div key={s.label} className="group rounded-lg bg-surface-alt px-3 py-2.5 border border-border-subtle">

                  {/* Row 1: label + tooltip | score + weight */}
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`size-1.5 rounded-full flex-shrink-0 ${STATUS_COLOR[s.status]}`} />
                      <span className="text-sm font-medium text-foreground">{s.label}</span>
                      <span className="relative inline-flex flex-shrink-0 group/tip">
                        <span className="text-muted hover:text-foreground cursor-help text-xs leading-none">ⓘ</span>
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal">
                          {s.tooltip}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {s.signalScore !== null ? (
                        <span className={`text-xs font-semibold tabular-nums w-12 text-right ${s.status === "ok" ? "text-accent-green" : s.status === "warn" ? "text-accent-orange" : "text-muted"}`}>
                          {Math.round(s.signalScore)}/100
                        </span>
                      ) : (
                        <span className="text-xs text-muted/50 tabular-nums w-12 text-right">—/100</span>
                      )}
                      <span className="text-2xs text-muted border border-border-subtle rounded px-1.5 py-0.5 tabular-nums font-medium w-14 text-center">
                        w {s.weight}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: bar + rawValue side by side */}
                  <div className="flex items-center gap-3 pl-3.5">
                    <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${SIGNAL_BAR_COLOR[s.status]}`}
                        style={{ width: s.signalScore !== null ? `${s.signalScore}%` : s.status === "na" ? "0%" : "50%" }}
                      />
                    </div>
                    <p className="text-xs text-muted min-w-0 truncate" title={s.rawValue}>
                      {s.rawValue}
                    </p>
                  </div>

                </div>
              ))}
            </div>
          </div>

          {/* ── Right column: activity + disclaimer + footer ── */}
          <div className="sm:w-52 flex flex-col gap-4 flex-shrink-0">

            {/* Activity pills */}
            {hasActivity && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted uppercase tracking-wide">Activity</p>
                <div className="flex flex-col gap-1.5">
                  {issuesOnlyCount !== null && organic.openPRsCount !== null && (
                    <a
                      href={`https://github.com/${owner}/${repo}/issues`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-surface-alt rounded-md px-2.5 py-2 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                    >
                      <AlertCircle className="size-3.5 text-muted flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {issuesOnlyCount.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted">issues</span>
                    </a>
                  )}
                  {organic.openPRsCount !== null && (
                    <a
                      href={`https://github.com/${owner}/${repo}/pulls`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-surface-alt rounded-md px-2.5 py-2 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                    >
                      <GitPullRequest className="size-3.5 text-muted flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {organic.openPRsCount.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted">open PRs</span>
                    </a>
                  )}
                  {organic.openIssuesCount !== null && organic.openPRsCount === null && (
                    <a
                      href={`https://github.com/${owner}/${repo}/issues`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-surface-alt rounded-md px-2.5 py-2 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                    >
                      <AlertCircle className="size-3.5 text-muted flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {organic.openIssuesCount.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted">issues & PRs</span>
                    </a>
                  )}
                  {organic.latestReleaseTag && organic.latestReleaseUrl && (
                    <a
                      href={organic.latestReleaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-surface-alt rounded-md px-2.5 py-2 border border-border-subtle hover:border-accent-blue/40 transition-colors"
                    >
                      <Star className="size-3.5 text-muted flex-shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">
                          {organic.latestReleaseTag}
                        </div>
                        {organic.latestReleaseAt && (
                          <div className="text-xs text-muted">
                            {new Date(organic.latestReleaseAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <p className="text-xs text-muted/80 leading-relaxed">
              Heuristic based on 5 public signals, not an accusation of fraud. Repos with viral
              growth or niche communities may score lower despite being organic.
              {organic.computedAt && (
                <>{" "}<span className="text-muted/60">
                  Computed {new Date(organic.computedAt).toLocaleDateString()}.
                </span></>
              )}
            </p>

            {/* Actions + links */}
            <div className="mt-auto space-y-2.5">
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                title="Re-fetch live data from GitHub and recompute (1× per hour)"
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors disabled:opacity-50 w-full justify-center"
              >
                {recalculating ? (
                  <>
                    <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                    Recalculating…
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3" aria-hidden="true" />
                    Recompute
                  </>
                )}
              </button>
              {recalcError && (
                <p className="text-xs text-accent-red text-center">{recalcError}</p>
              )}
              <div className="flex flex-col gap-1 text-xs">
                <a
                  href={disputeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Dispute or request removal →
                </a>
                <a
                  href="https://arxiv.org/abs/2412.13459"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue/70 hover:text-accent-blue transition-colors"
                >
                  CMU/StarScout paper
                </a>
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
        </div>
      </div>
    </Modal>
  );
};
