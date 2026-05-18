// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, clearCache, loadCache, saveCache, type LocalCache } from "@/lib/repo-cache";

const makeStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
  };
};

const cacheData: Omit<LocalCache, "version"> = {
  points: [],
  unmapped: [],
  totalCount: 42,
  scannedAt: 1_700_000_000_000,
  latestStarredAt: "2026-01-01T00:00:00Z",
};

describe("repo scan local cache", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: makeStorage(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a stable owner/repo cache key", () => {
    expect(cacheKey("FlorianBruniaux", "starmapper")).toBe("starmapper:FlorianBruniaux/starmapper");
  });

  it("saves and loads version 1 cache payloads", () => {
    saveCache("octocat", "hello-world", cacheData);

    expect(loadCache("octocat", "hello-world")).toEqual({ version: 1, ...cacheData });
  });

  it("returns null for missing cache entries", () => {
    expect(loadCache("octocat", "missing")).toBeNull();
  });

  it("returns null for unsupported cache versions", () => {
    localStorage.setItem(cacheKey("octocat", "old"), JSON.stringify({ version: 0, ...cacheData }));

    expect(loadCache("octocat", "old")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(cacheKey("octocat", "broken"), "{not-json");

    expect(loadCache("octocat", "broken")).toBeNull();
  });

  it("removes a cache entry without throwing", () => {
    saveCache("octocat", "hello-world", cacheData);

    clearCache("octocat", "hello-world");

    expect(loadCache("octocat", "hello-world")).toBeNull();
  });
});
