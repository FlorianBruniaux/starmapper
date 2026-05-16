// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { checkDbHealth, DB_WARN_PCT, DB_CRITICAL_PCT } from "@/lib/db-health";

// ─── Bust the module-level cache between tests ────────────────────────────────
// db-health.ts caches the result for 5 minutes (CACHE_TTL_MS).
// We advance Date.now by 10 minutes per test so cached.ts is always stale.

let fakeNow = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fakeNow += 10 * 60 * 1000; // +10 min each test — always exceeds 5-min TTL
  vi.spyOn(Date, "now").mockReturnValue(fakeNow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("DB_WARN_PCT is 80", () => expect(DB_WARN_PCT).toBe(80));
  it("DB_CRITICAL_PCT is 95", () => expect(DB_CRITICAL_PCT).toBe(95));
});

// ── checkDbHealth() ───────────────────────────────────────────────────────────

describe("checkDbHealth()", () => {
  it("returns ok:true with usagePct when DB query succeeds", async () => {
    // 50 GB used out of 100 GB default = 50%
    const fiftyGb = BigInt(50 * 1024 * 1024 * 1024);
    mockQueryRaw.mockResolvedValue([{ size: fiftyGb }]);
    const health = await checkDbHealth();
    expect(health.ok).toBe(true);
    if (health.ok) {
      expect(health.usagePct).toBe(50);
    }
  });

  it("returns ok:false when DB query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));
    const health = await checkDbHealth();
    expect(health.ok).toBe(false);
  });

  it("caches the result and skips the DB on a second call within TTL", async () => {
    mockQueryRaw.mockResolvedValue([{ size: BigInt(1024) }]);
    // First call — hits DB
    await checkDbHealth();
    // Reset Date.now to same fakeNow so TTL hasn't expired
    // (no need to re-mock; vi.restoreAllMocks not called yet)
    // Second call — should use cache, no second query
    await checkDbHealth();
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns ok:true for a very small DB (near 0% usage)", async () => {
    mockQueryRaw.mockResolvedValue([{ size: BigInt(1024) }]);
    const health = await checkDbHealth();
    expect(health.ok).toBe(true);
    if (health.ok) {
      expect(health.usagePct).toBeGreaterThanOrEqual(0);
      expect(health.usagePct).toBeLessThan(5);
    }
  });
});
