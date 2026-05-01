// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getSubscriptions,
  hasSubscription,
  addSubscription,
  removeSubscription,
} from "@/lib/subscriptions";

// ─── localStorage mock ────────────────────────────────────────────────────────

const makeLocalStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
};

let mockStorage: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  mockStorage = makeLocalStorage();
  vi.stubGlobal("localStorage", mockStorage);
  vi.stubGlobal("window", { localStorage: mockStorage });
});

// ─── getSubscriptions ─────────────────────────────────────────────────────────

describe("getSubscriptions", () => {
  it("returns empty array when nothing stored", () => {
    expect(getSubscriptions()).toEqual([]);
  });

  it("returns stored subscriptions", () => {
    addSubscription("torvalds");
    const subs = getSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].login).toBe("torvalds");
    expect(typeof subs[0].subscribedAt).toBe("number");
  });

  it("returns empty array when localStorage has invalid JSON", () => {
    mockStorage.setItem("starmapper:subs", "not json");
    expect(getSubscriptions()).toEqual([]);
  });

  it("returns empty array when stored value is a number", () => {
    mockStorage.setItem("starmapper:subs", "123");
    expect(getSubscriptions()).toEqual([]);
  });

  it("filters out entries with wrong shape", () => {
    mockStorage.setItem("starmapper:subs", JSON.stringify([{ foo: 1 }, { login: "foo", subscribedAt: 1 }]));
    const subs = getSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].login).toBe("foo");
  });

  it("returns empty array in SSR context (window undefined)", () => {
    vi.stubGlobal("window", undefined);
    expect(getSubscriptions()).toEqual([]);
  });
});

// ─── hasSubscription ──────────────────────────────────────────────────────────

describe("hasSubscription", () => {
  it("returns false when not subscribed", () => {
    expect(hasSubscription("torvalds")).toBe(false);
  });

  it("returns true after subscribing", () => {
    addSubscription("torvalds");
    expect(hasSubscription("torvalds")).toBe(true);
  });

  it("is case-insensitive", () => {
    addSubscription("Torvalds");
    expect(hasSubscription("torvalds")).toBe(true);
    expect(hasSubscription("TORVALDS")).toBe(true);
  });

  it("returns false after unsubscribing", () => {
    addSubscription("torvalds");
    removeSubscription("torvalds");
    expect(hasSubscription("torvalds")).toBe(false);
  });
});

// ─── addSubscription ──────────────────────────────────────────────────────────

describe("addSubscription", () => {
  it("adds a new login", () => {
    addSubscription("torvalds");
    expect(getSubscriptions()).toHaveLength(1);
  });

  it("lowercases the login", () => {
    addSubscription("Torvalds");
    expect(getSubscriptions()[0].login).toBe("torvalds");
  });

  it("is idempotent — no duplicate on second call", () => {
    addSubscription("torvalds");
    addSubscription("torvalds");
    expect(getSubscriptions()).toHaveLength(1);
  });

  it("re-inserts at front when called again (order refresh)", () => {
    addSubscription("torvalds");
    addSubscription("gvanrossum");
    addSubscription("torvalds"); // re-add existing → moves to front
    const subs = getSubscriptions();
    expect(subs[0].login).toBe("torvalds");
    expect(subs[1].login).toBe("gvanrossum");
    expect(subs).toHaveLength(2);
  });

  it("caps at 100 entries with FIFO eviction", () => {
    for (let i = 0; i < 101; i++) addSubscription(`user${i}`);
    const subs = getSubscriptions();
    expect(subs).toHaveLength(100);
    // user0 was added first — it should be evicted (last in the final array after 101 inserts)
    expect(subs.find((s) => s.login === "user0")).toBeUndefined();
  });

  it("returns the updated list", () => {
    const result = addSubscription("torvalds");
    expect(result).toHaveLength(1);
    expect(result[0].login).toBe("torvalds");
  });
});

// ─── removeSubscription ───────────────────────────────────────────────────────

describe("removeSubscription", () => {
  it("removes an existing login", () => {
    addSubscription("torvalds");
    removeSubscription("torvalds");
    expect(getSubscriptions()).toHaveLength(0);
  });

  it("is a no-op if login is not present", () => {
    addSubscription("torvalds");
    removeSubscription("nonexistent");
    expect(getSubscriptions()).toHaveLength(1);
  });

  it("does not throw on empty store", () => {
    expect(() => removeSubscription("torvalds")).not.toThrow();
  });

  it("returns the updated list", () => {
    addSubscription("torvalds");
    addSubscription("gvanrossum");
    const result = removeSubscription("torvalds");
    expect(result).toHaveLength(1);
    expect(result[0].login).toBe("gvanrossum");
  });

  it("is case-insensitive", () => {
    addSubscription("torvalds");
    removeSubscription("TORVALDS");
    expect(getSubscriptions()).toHaveLength(0);
  });
});
