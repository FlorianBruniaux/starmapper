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
  contribution: string | null;
  status: "ok" | "warn" | "na";
};

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const buildSignals = (organic: RepoOrganic): SignalRow[] => {
  const rows: SignalRow[] = [];
  const { score, totalCount, forksCount, watchersCount } = organic;

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

  if (forksCount !== null && totalCount > 0) {
    const ratio = forksCount / totalCount;
    rows.push({
      label: "Fork / star ratio",
      tooltip: FORK_TOOLTIP,
      rawValue: `${fmtPct(ratio)} (${forksCount.toLocaleString()} forks / ${totalCount.toLocaleString()} ★)`,
      contribution: score !== null ? `weight 70%` : null,
      status: ratio >= 0.07 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Fork / star ratio",
      tooltip: FORK_TOOLTIP,
      rawValue: totalCount < 5000 ? `Gated — repo has < 5 000 stars` : "No data",
      contribution: null,
      status: "na",
    });
  }

  if (watchersCount !== null && totalCount > 0) {
    const ratio = watchersCount / totalCount;
    rows.push({
      label: "Watcher / star ratio",
      tooltip: WATCHER_TOOLTIP,
      rawValue: `${fmtPct(ratio)} (${watchersCount.toLocaleString()} watchers)`,
      contribution: score !== null ? `weight 10%` : null,
      status: ratio >= 0.005 ? "ok" : "warn",
    });
  } else {
    rows.push({
      label: "Watcher / star ratio",
      tooltip: WATCHER_TOOLTIP,
      rawValue: "No data",
      contribution: null,
      status: "na",
    });
  }

  rows.push({
    label: "Zero-follower stargazers",
    tooltip: ZF_TOOLTIP,
    rawValue: "Computed from enriched users in our DB",
    contribution: score !== null ? `weight 20%` : null,
    status: "ok",
  });

  return rows;
};

const TIER_COLOR: Record<string, string> = {
  healthy:      "text-accent-green",
  moderate:     "text-orange-400",
  suspicious:   "text-accent-red",
  insufficient: "text-muted",
};

const TIER_LABEL: Record<string, string> = {
  healthy:      "Healthy",
  moderate:     "Moderate",
  suspicious:   "Suspicious",
  insufficient: "Insufficient data",
};

const STATUS_DOT: Record<string, string> = {
  ok: "bg-accent-green",
  warn: "bg-orange-400",
  na: "bg-muted",
};

export const OrganicScoreModal = ({ open, onClose, organic, owner, repo, onRecalculated }: Props) => {
  const [recalculating, setRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const signals = buildSignals(organic);
  const tierColor = TIER_COLOR[organic.tier] ?? "text-muted";
  const tierLabel = TIER_LABEL[organic.tier] ?? organic.tier;

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

  return (
    <Modal open={open} onClose={onClose} title="Organic Score" maxWidth="max-w-lg">
      <div className="px-6 py-4 space-y-4">
        {/* Experimental badge */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 text-2xs font-medium uppercase tracking-wide">
            Experimental
          </span>
          <span className="text-2xs text-muted">Scores may be inaccurate — feedback welcome</span>
        </div>

        {/* Score header */}
        <div className="flex items-center gap-3">
          <span className={`text-4xl font-bold tabular-nums ${tierColor}`}>
            {organic.score !== null ? organic.score : "—"}
          </span>
          <div>
            <div className={`font-semibold text-sm ${tierColor}`}>{tierLabel}</div>
            <div className="text-xs text-muted">out of 100</div>
          </div>
        </div>

        {/* Signals table */}
        <div className="space-y-2">
          {signals.map((s) => (
            <div key={s.label} className="flex items-start gap-2 text-sm">
              <span className={`mt-1.5 size-2 rounded-full flex-shrink-0 ${STATUS_DOT[s.status]}`} />
              <div className="flex-1 min-w-0">
                <span className="text-foreground font-medium">{s.label}</span>
                {s.contribution && (
                  <span className="ml-2 text-xs text-muted">({s.contribution})</span>
                )}
                <span className="relative inline-block ml-1.5 align-middle group/tip">
                  <span className="text-muted hover:text-foreground cursor-help text-xs">ⓘ</span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-md bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal">
                    {s.tooltip}
                  </span>
                </span>
                <div className="text-muted text-xs mt-0.5 truncate">{s.rawValue}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Activity row */}
        {(organic.openIssuesCount !== null || organic.latestReleaseTag) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted border-t border-border-subtle pt-3">
            {organic.openIssuesCount !== null && (
              <span>{organic.openIssuesCount.toLocaleString()} open issues &amp; PRs</span>
            )}
            {organic.latestReleaseTag && organic.latestReleaseUrl && (
              <a
                href={organic.latestReleaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Latest release: {organic.latestReleaseTag}
                {organic.latestReleaseAt && (
                  <span className="ml-1 text-muted">
                    ({new Date(organic.latestReleaseAt).toLocaleDateString()})
                  </span>
                )}
                <span className="ml-1">↗</span>
              </a>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-muted leading-relaxed border-t border-border-subtle pt-3">
          This score is a heuristic based on 3 public signals. It is not an accusation of fraud.
          Repos with viral growth or niche communities may score lower despite being organic.
          {organic.computedAt && (
            <span className="block mt-1">
              Computed {new Date(organic.computedAt).toLocaleDateString()}.
            </span>
          )}
        </p>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            title="Re-fetch live data from GitHub and recompute the score (1× per hour)"
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors disabled:opacity-50"
          >
            {recalculating ? "Recalculating…" : "Recompute"}
          </button>
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

        {/* Links */}
        <div className="flex gap-3 text-xs">
          <a
            href="https://arxiv.org/abs/2412.13459"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline"
          >
            CMU/StarScout paper
          </a>
          <span className="text-muted">·</span>
          <a
            href="/organic-score/calibration"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue hover:underline"
          >
            Calibration data
          </a>
        </div>
      </div>
    </Modal>
  );
};
