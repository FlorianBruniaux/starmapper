// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    roadmapVote: { count: (...args: unknown[]) => mockCount(...args) },
  },
}));

import { getTallies } from "@/lib/roadmap-vote";

describe("getTallies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all four keys at 0 when the table is empty", async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const result = await getTallies();
    expect(result).toEqual({ tallies: { A: 0, B: 0, C: 0, D: 0 }, totalVoters: 0 });
  });

  it("sums tallies above totalVoters for overlapping multi-select rows", async () => {
    mockQueryRaw.mockResolvedValue([
      { option: "A", count: 3n },
      { option: "C", count: 3n },
      { option: "D", count: 1n },
    ]);
    mockCount.mockResolvedValue(3);
    const result = await getTallies();
    expect(result.tallies).toEqual({ A: 3, B: 0, C: 3, D: 1 });
    expect(result.totalVoters).toBe(3);
    const sum = Object.values(result.tallies).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(result.totalVoters);
  });

  it("propagates a $queryRaw failure to the caller", async () => {
    mockQueryRaw.mockRejectedValue(new Error("db down"));
    mockCount.mockResolvedValue(0);
    await expect(getTallies()).rejects.toThrow("db down");
  });
});
