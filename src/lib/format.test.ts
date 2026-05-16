// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { formatEstimate, fmt, timeAgo } from "@/lib/format";

afterEach(() => vi.restoreAllMocks());

// ── formatEstimate ───────────────────────────────────────────────────────────

describe("formatEstimate()", () => {
  it("returns ~N unit when min === max", () => {
    expect(formatEstimate({ min: 5, max: 5, unit: "min", keepOpen: false })).toBe("~5 min");
  });

  it("returns range when min !== max", () => {
    expect(formatEstimate({ min: 2, max: 4, unit: "sec", keepOpen: false })).toBe("2–4 sec");
  });

  it("works with hours unit", () => {
    expect(formatEstimate({ min: 1, max: 2, unit: "h", keepOpen: true })).toBe("1–2 h");
  });
});

// ── fmt ──────────────────────────────────────────────────────────────────────

describe("fmt()", () => {
  it("returns string as-is for numbers below 1000", () => {
    expect(fmt(999)).toBe("999");
    expect(fmt(0)).toBe("0");
  });

  it("formats 1000 as 1.0k", () => {
    expect(fmt(1000)).toBe("1.0k");
  });

  it("formats 1234 as 1.2k", () => {
    expect(fmt(1234)).toBe("1.2k");
  });

  it("formats 10000 as 10.0k", () => {
    expect(fmt(10000)).toBe("10.0k");
  });
});

// ── timeAgo ──────────────────────────────────────────────────────────────────

describe("timeAgo()", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  it('returns "just now" for less than 1 minute', () => {
    expect(timeAgo(now - 30_000)).toBe("just now");
  });

  it('returns "Xmin ago" for minutes', () => {
    expect(timeAgo(now - 5 * 60_000)).toBe("5min ago");
  });

  it('returns "Xh ago" for hours', () => {
    expect(timeAgo(now - 3 * 3_600_000)).toBe("3h ago");
  });

  it('returns "Xd ago" for days', () => {
    expect(timeAgo(now - 2 * 86_400_000)).toBe("2d ago");
  });
});
