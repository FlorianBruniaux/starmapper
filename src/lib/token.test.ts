// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// This file runs in the "node" vitest project (environment: node), which has
// no localStorage global — stub a Map-backed implementation, same shape as
// the jsdom polyfill in vitest.setup.ts.
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};
vi.stubGlobal("localStorage", localStorageStub);

const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("token storage TTL", () => {
  it("a token written today is readable immediately", async () => {
    const { getStoredToken, setStoredToken } = await import("./token");
    setStoredToken("ghp_test123");
    expect(getStoredToken()).toBe("ghp_test123");
  });

  it("expires at the absolute ceiling even when rolling TTL would still be valid", async () => {
    const { getStoredToken, setStoredToken } = await import("./token");
    setStoredToken("ghp_test123");

    // Advance in increments smaller than the rolling TTL, reading (and thus
    // refreshing `exp`) each time, until we cross the absolute ceiling.
    const stepMs = TOKEN_TTL_MS - 60_000; // just under the rolling window
    let elapsed = 0;
    while (elapsed + stepMs < ABSOLUTE_TTL_MS) {
      vi.advanceTimersByTime(stepMs);
      elapsed += stepMs;
      // Rolling TTL alone would keep this alive — confirm it does, so far.
      expect(getStoredToken()).toBe("ghp_test123");
    }

    // Cross the absolute ceiling — rolling TTL is still fresh from the last read.
    vi.advanceTimersByTime(stepMs);
    expect(getStoredToken()).toBe("");
  });

  it("keeps the same absExp across rolling refreshes, does not reset it", async () => {
    const { getStoredToken, setStoredToken } = await import("./token");
    setStoredToken("ghp_test123");

    const rawBefore = localStorage.getItem("gh_token");
    expect(rawBefore).not.toBeNull();
    const absExpBefore = JSON.parse(rawBefore as string).absExp;

    vi.advanceTimersByTime(60_000);
    expect(getStoredToken()).toBe("ghp_test123");

    const rawAfter = localStorage.getItem("gh_token");
    const parsedAfter = JSON.parse(rawAfter as string);
    expect(parsedAfter.absExp).toBe(absExpBefore);
    // Rolling exp was refreshed relative to the new "now"
    expect(parsedAfter.exp).toBe(Date.now() + TOKEN_TTL_MS);
  });

  it("rolling TTL expiry still triggers independently of the absolute ceiling", async () => {
    const { getStoredToken, setStoredToken } = await import("./token");
    setStoredToken("ghp_test123");

    vi.advanceTimersByTime(TOKEN_TTL_MS + 60_000);
    expect(getStoredToken()).toBe("");
  });
});
