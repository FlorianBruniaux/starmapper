// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Organic Score: heuristic 0-100 measuring how "natural" a repo's star base looks.
// Based on 3 public signals documented in the CMU/StarScout ICSE 2026 study.
//
// Weights and paliers calibrated empirically on 2026-04-21 — see docs/organic-score-calibration.md

export type OrganicTier = "healthy" | "moderate" | "suspicious" | "insufficient";

export type OrganicSignals = {
  starsCount: number;
  forksCount: number;
  watchersCount: number;       // subscribers_count from GitHub REST (not stargazers)
  zeroFollowerCount: number | null;  // users with followers=0, from github_user WHERE dataVersion >= 1
  sampleSize: number | null;         // enriched users in our DB who starred this repo
};

export type OrganicResult = {
  score: number | null;
  tier: OrganicTier;
  signals: {
    forkRatio: number | null;
    watcherRatio: number | null;
    zeroFollowerPct: number | null;
    sampleSize: number;
  };
  activeSignals: string[];
  reasons: string[];
};

// Calibrated paliers — see docs/organic-score-calibration.md
// Fork/star (w=70%): ≥0.10 → 100, 0.07 → 50, ≤0.02 → 0
// Watcher/star (w=5%): ≥0.005 → 100, 0.001 → 50, ≤0.0001 → 0
//   Paliers recalibrated 2026-04-22 (original [2%,0.5%,0.1%] was AI-framework only).
//   Weight reduced 2026-04-22: 10%→5% — signal barely discriminates in practice,
//   most repos (healthy AND suspicious) score 75-100. See corpus analysis.
// Zero-follower % (w=25%): ≤10 → 100, 30 → 50, ≥60 → 0

const lerp = (v: number, lo: number, hi: number, outLo: number, outHi: number): number =>
  outLo + ((v - lo) / (hi - lo)) * (outHi - outLo);

const clamp = (v: number): number => Math.max(0, Math.min(100, v));

const normForkRatio = (v: number): number => {
  if (v >= 0.10) return 100;
  if (v <= 0.02) return 0;
  if (v >= 0.07) return clamp(lerp(v, 0.07, 0.10, 50, 100));
  return clamp(lerp(v, 0.02, 0.07, 0, 50));
};

const normWatcherRatio = (v: number): number => {
  if (v >= 0.005) return 100;                                      // ≥ 0.5% → 100
  if (v <= 0.0001) return 0;                                       // ≤ 0.01% → 0
  if (v >= 0.001) return clamp(lerp(v, 0.001, 0.005, 50, 100));   // 0.1%–0.5% → [50,100]
  return clamp(lerp(v, 0.0001, 0.001, 0, 50));                     // 0.01%–0.1% → [0,50]
};

const normZeroFollowerPct = (v: number): number => {
  if (v <= 10) return 100;
  if (v >= 60) return 0;
  if (v <= 30) return clamp(lerp(v, 10, 30, 100, 50));
  return clamp(lerp(v, 30, 60, 50, 0));
};

const WEIGHT_FORK   = 40;  // reduced from 70 — fork signal too dominant, penalised CLI tools with low fork/star
const WEIGHT_WATCH  = 5;
const WEIGHT_ZF     = 55;  // increased from 25 — ZF is the strongest discriminator when sample is sufficient

const GATE_FORK_MIN_STARS = 5000;
const GATE_ZF_MIN_SAMPLE  = 30;

export const computeOrganicScore = (input: OrganicSignals): OrganicResult => {
  const { starsCount, forksCount, watchersCount, zeroFollowerCount, sampleSize } = input;

  if (starsCount === 0) {
    return {
      score: null,
      tier: "insufficient",
      signals: { forkRatio: null, watcherRatio: null, zeroFollowerPct: null, sampleSize: 0 },
      activeSignals: [],
      reasons: ["Repo has 0 stars"],
    };
  }

  const forkRatio    = forksCount / starsCount;
  const watcherRatio = watchersCount / starsCount;
  const zeroFollowerPct =
    sampleSize !== null && sampleSize >= GATE_ZF_MIN_SAMPLE && zeroFollowerCount !== null
      ? (zeroFollowerCount / sampleSize) * 100
      : null;

  const forkActive   = starsCount >= GATE_FORK_MIN_STARS;
  const watchActive  = true;
  const zfActive     = zeroFollowerPct !== null;

  type WeightedPair = [number, number]; // [normalizedScore, weight]
  const active: WeightedPair[] = [];
  const activeSignals: string[] = [];
  const reasons: string[] = [];

  if (forkActive) {
    active.push([normForkRatio(forkRatio), WEIGHT_FORK]);
    activeSignals.push("fork_ratio");
  } else {
    reasons.push(`Fork signal gated (stars ${starsCount.toLocaleString()} < ${GATE_FORK_MIN_STARS.toLocaleString()})`);
  }

  if (watchActive) {
    active.push([normWatcherRatio(watcherRatio), WEIGHT_WATCH]);
    activeSignals.push("watcher_ratio");
  }

  if (zfActive) {
    active.push([normZeroFollowerPct(zeroFollowerPct!), WEIGHT_ZF]);
    activeSignals.push("zero_follower_pct");
  } else {
    reasons.push(
      sampleSize !== null && sampleSize < GATE_ZF_MIN_SAMPLE
        ? `Zero-follower signal gated (sample size ${sampleSize} < ${GATE_ZF_MIN_SAMPLE})`
        : "Zero-follower signal unavailable (repo not in StarMapper DB)",
    );
  }

  if (active.length === 0) {
    return {
      score: null,
      tier: "insufficient",
      signals: { forkRatio: null, watcherRatio: null, zeroFollowerPct: null, sampleSize: 0 },
      activeSignals: [],
      reasons: [...reasons, "No signals available"],
    };
  }

  const totalWeight = active.reduce((s, [, w]) => s + w, 0);
  const rawScore = active.reduce((s, [v, w]) => s + v * w, 0) / totalWeight;
  const score = Math.round(rawScore);

  const tier: OrganicTier =
    score >= 70 ? "healthy" :
    score >= 45 ? "moderate" :
    "suspicious";

  return {
    score,
    tier,
    signals: {
      forkRatio:       forkActive   ? forkRatio        : null,
      watcherRatio:    watchActive  ? watcherRatio      : null,
      zeroFollowerPct: zfActive     ? zeroFollowerPct! : null,
      sampleSize:      sampleSize ?? 0,
    },
    activeSignals,
    reasons,
  };
};

export const tierLabel = (tier: OrganicTier): string => ({
  healthy:     "Healthy",
  moderate:    "Moderate",
  suspicious:  "Suspicious",
  insufficient: "Not enough data",
})[tier];
