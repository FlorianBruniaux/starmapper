// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { OrganicTier } from "@/lib/organic-score";

type Props =
  | { pending: true; totalStars?: number; onClick?: () => void }
  | { pending?: false; score: number | null; tier: OrganicTier; onClick?: () => void };

const TIER_STYLES: Record<OrganicTier, string> = {
  healthy:      "bg-accent-green/15 text-accent-green border-accent-green/30",
  moderate:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
  suspicious:   "bg-accent-red/15 text-accent-red border-accent-red/30",
  insufficient: "bg-surface-alt text-muted border-border",
};

const TIER_ICON: Record<OrganicTier, string> = {
  healthy:      "✓",
  moderate:     "~",
  suspicious:   "⚠",
  insufficient: "?",
};

const TIER_TOOLTIP: Record<OrganicTier, string> = {
  healthy:      "Organic growth signals look normal",
  moderate:     "Some signals are below average",
  suspicious:   "Fork/star or watcher/star ratio is unusually low",
  insufficient: "Not enough data to compute an organic score",
};

export const OrganicScorePill = (props: Props) => {
  if (props.pending) {
    const tooltip = (props.totalStars ?? 0) < 5000
      ? "Organic score needs 5 000+ stars"
      : "Organic score not yet computed — check back soon";
    return (
      <div
        title={tooltip}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-xs font-medium text-muted bg-surface-alt cursor-default"
      >
        <span>○</span>
        <span>—</span>
      </div>
    );
  }

  const { score, tier, onClick } = props;
  const label = score !== null ? `${score}` : "—";
  const tooltip = TIER_TOOLTIP[tier];

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={[
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium",
        "cursor-pointer transition-opacity hover:opacity-80",
        TIER_STYLES[tier],
      ].join(" ")}
    >
      <span>{TIER_ICON[tier]}</span>
      <span>{label}</span>
    </button>
  );
};
