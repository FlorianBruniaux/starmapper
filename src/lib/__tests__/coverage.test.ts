// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { computeCoverage } from "@/lib/coverage";

describe("computeCoverage", () => {
  it("applies the 0.3 geolocation-rate factor, not raw N/M", () => {
    // N=1000, M=1000 → raw would be 100%, weighted should be 30%
    expect(computeCoverage(1000, 1000)).toBe(30);
  });

  it("clamps at 100 when the weighted ratio would exceed it", () => {
    expect(computeCoverage(10000, 1000)).toBe(100);
  });

  it("returns 0 when liveStarCount is 0", () => {
    expect(computeCoverage(500, 0)).toBe(0);
  });

  it("rounds to the nearest integer", () => {
    expect(computeCoverage(333, 1000)).toBe(10); // 0.3 * 333/1000 = 9.99 → 10
  });
});
