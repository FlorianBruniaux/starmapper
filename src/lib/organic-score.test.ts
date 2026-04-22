// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { computeOrganicScore } from "./organic-score";

// Golden cases from calibration — docs/organic-score-calibration.md (2026-04-21)
// Expected scores computed with weights fork=70%, watcher=10%, zero-follower=20%

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

  it("rtk-ai/rtk — CLI tool: moderate (not suspicious) despite low watcher ratio", () => {
    // CLI tools structurally have low watcher/star ratio (users install via Homebrew/Cargo, never revisit GitHub).
    // Watcher thresholds recalibrated 2026-04-22 to avoid flagging legitimate CLI repos as suspicious.
    const result = computeOrganicScore({
      starsCount:         25_450,
      forksCount:         1_847,    // fork/★ = 0.073
      watchersCount:      80,       // watcher/★ = 0.003 — structurally low for CLI tools
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.tier).not.toBe("suspicious");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(50);
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
    expect(result.score!).toBeLessThanOrEqual(15);
  });

  it("langflow — suspicious when no zf% in DB (fork/★ = 0.060 dominates)", () => {
    // Our DB has post-deletion data (zf%=4% — survivors bias), so we test API-only mode.
    // The fork/star signal alone correctly flags this: 0.060 normalises to ~40/100.
    const result = computeOrganicScore({
      starsCount:         147_213,
      forksCount:         8_833,    // fork/★ = 0.060
      watchersCount:      471,      // watcher/★ = 0.0032
      zeroFollowerCount:  null,
      sampleSize:         null,
    });
    expect(result.tier).toBe("suspicious");
    expect(result.score!).toBeLessThanOrEqual(50);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("small repo (< 5000 stars) — fork signal gated, returns result from watcher only", () => {
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
    // fork gated (0 < 5000), watcher ratio = 0/0 handled
    expect(() => result).not.toThrow();
    expect(result.score).toBeNull();
    expect(result.tier).toBe("insufficient");
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
