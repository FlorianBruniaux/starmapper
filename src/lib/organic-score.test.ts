// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { computeOrganicScore } from "./organic-score";

// Golden cases from calibration — probe-star-burst.ts run 2026-04-22
// Weights: fork=40%, watcher=5%, zero-follower=55%
// Rationale: ZF is strongest discriminator when sample ≥ 30; fork weight reduced to avoid
// penalising CLI tools (low fork/star by nature) — confirmed by corpus analysis.

describe("computeOrganicScore", () => {
  // ── Healthy corpus ────────────────────────────────────────────────────────

  it("flask — flagship healthy baseline", () => {
    const result = computeOrganicScore({
      starsCount:         71_432,
      forksCount:         16_784,   // fork/★ = 0.235
      watchersCount:      2_084,    // watcher/★ = 0.029
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.tier).toBe("healthy");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(80);
    expect(result.activeSignals).toContain("fork_ratio");
  });

  it("langchain — healthy with low watcher ratio", () => {
    // watcher/★ = 0.0064 (low but organic — active dev community watchers)
    const result = computeOrganicScore({
      starsCount:         134_373,
      forksCount:         22_172,   // fork/★ = 0.165
      watchersCount:      859,      // watcher/★ = 0.0064
      zeroFollowerCount:  247,      // zf% = 3.4% (n=7281)
      sampleSize:         7_281,
    });
    expect(result.tier).toBe("healthy");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.activeSignals).toContain("zero_follower_pct");
  });

  it("browser-use — fast-growing healthy (YC W25)", () => {
    const result = computeOrganicScore({
      starsCount:         89_197,
      forksCount:         10_168,   // fork/★ = 0.114
      watchersCount:      428,      // watcher/★ = 0.0048
      zeroFollowerCount:  370,      // zf% = 3.7% (n=9999)
      sampleSize:         9_999,
    });
    expect(result.tier).toBe("healthy");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("rtk-ai/rtk — CLI tool: healthy despite low fork/star ratio, strong ZF signal", () => {
    // Weight rebalance 2026-04-22: fork 70%→40%, ZF 25%→55%.
    // RTK has fork/★ = 0.058 (low for CLI tools — users install via Homebrew/Cargo, don't fork)
    // but excellent ZF signal (7.4% zero-followers, n=5284). ZF now carries enough weight to score healthy.
    const result = computeOrganicScore({
      starsCount:         32_308,
      forksCount:         1_880,    // fork/★ = 0.058
      watchersCount:      84,       // watcher/★ = 0.0026
      zeroFollowerCount:  390,      // zf% = 7.4% — very healthy (n=5284)
      sampleSize:         5_284,
    });
    expect(result.tier).toBe("healthy");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(70);
    expect(result.activeSignals).toContain("zero_follower_pct");
  });

  // ── Suspicious corpus ─────────────────────────────────────────────────────

  it("unionlabs/union — suspicious (StarScout 47.4% fake, #1 ROSS Index)", () => {
    const result = computeOrganicScore({
      starsCount:         74_134,
      forksCount:         3_855,    // fork/★ = 0.052
      watchersCount:      1_608,    // watcher/★ = 0.022
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.tier).toBe("suspicious");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeLessThanOrEqual(50);
  });

  it("shardeum — suspicious (fork/★ = 0.022, extreme)", () => {
    const result = computeOrganicScore({
      starsCount:         31_497,
      forksCount:         693,      // fork/★ = 0.022
      watchersCount:      296,      // watcher/★ = 0.0094
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.tier).toBe("suspicious");
    // Weight rebalance 2026-05-06: fork 40%→30%, releases added 20%.
    // Without releases/ZF, watcher weight increases relative to fork → score shifts up slightly.
    expect(result.score!).toBeLessThanOrEqual(20);
  });

  it("langflow — moderate/suspicious when no zf% in DB (fork/★ = 0.060 dominates)", () => {
    // Our DB has post-deletion data (zf%=4% — survivors bias), so we test API-only mode.
    // Weight rebalance 2026-05-06: without ZF or releases active, watcher dilutes fork less.
    // Score shifts from 44 → 45 (moderate boundary). Intent: stays at or below moderate.
    const result = computeOrganicScore({
      starsCount:         147_213,
      forksCount:         8_833,    // fork/★ = 0.060
      watchersCount:      471,      // watcher/★ = 0.0032
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.score!).toBeLessThanOrEqual(50);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("small repo (< 500 stars) — returns insufficient, too small for reliable signals", () => {
    const result = computeOrganicScore({
      starsCount:         199,
      forksCount:         169,
      watchersCount:      8,
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.score).toBeNull();
    expect(result.tier).toBe("insufficient");
    expect(result.reasons[0]).toMatch(/too small/);
  });

  it("repo with 500+ stars (< 5000) — fork signal gated, returns result from watcher only", () => {
    const result = computeOrganicScore({
      starsCount:         1_292,
      forksCount:         200,
      watchersCount:      18,       // watcher/★ = 0.0139
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.signals.forkRatio).toBeNull();
    expect(result.activeSignals).not.toContain("fork_ratio");
    expect(result.score).not.toBeNull();
    expect(result.tier).not.toBe("insufficient");
  });

  it("zero stars — returns insufficient gracefully, no division by zero", () => {
    const result = computeOrganicScore({
      starsCount:         0,
      forksCount:         0,
      watchersCount:      0,
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(() => result).not.toThrow();
    expect(result.score).toBeNull();
    expect(result.tier).toBe("insufficient");
  });

  it("repo with 0 releases — releases signal excluded, not penalised", () => {
    const withZero = computeOrganicScore({
      starsCount:         5_000,
      forksCount:         500,
      watchersCount:      100,
      zeroFollowerCount:  null,
      sampleSize:         null,
      releasesCount:      0,
    });
    const withNull = computeOrganicScore({
      starsCount:         5_000,
      forksCount:         500,
      watchersCount:      100,
      zeroFollowerCount:  null,
      sampleSize:         null,
      releasesCount:      null,
    });
    expect(withZero.activeSignals).not.toContain("releases_count");
    expect(withZero.score).toEqual(withNull.score);
    expect(withZero.reasons.some(r => r.includes("0 releases"))).toBe(true);
  });

  it("large sample with healthy zero-follower % raises score", () => {
    const low = computeOrganicScore({
      starsCount:         50_000,
      forksCount:         3_000,    // fork/★ = 0.060 — borderline suspicious
      watchersCount:      200,
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    const high = computeOrganicScore({
      starsCount:         50_000,
      forksCount:         3_000,
      watchersCount:      200,
      zeroFollowerCount:  100,      // zf% = 2.5% — very healthy
      sampleSize:         4_000,
    });
    expect(high.score!).toBeGreaterThan(low.score!);
    expect(high.activeSignals).toContain("zero_follower_pct");
  });
});
