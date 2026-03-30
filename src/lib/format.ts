// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

export type TimeEstimate = {
  min: number;
  max: number;
  unit: "sec" | "min" | "h";
  keepOpen: boolean;
};

export const formatEstimate = (e: TimeEstimate): string => {
  if (e.min === e.max) return `~${e.min} ${e.unit}`;
  return `${e.min}–${e.max} ${e.unit}`;
};

/** Compact number formatter: 1234 → "1.2k", 999 → "999". */
export const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const timeAgo = (ms: number): string => {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}min ago`;
  return "just now";
};
