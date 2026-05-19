// src/hooks/use-repo-cache-loader.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLoadCache = vi.fn();
const mockSaveCache = vi.fn();
const mockSaveBookmark = vi.fn();
const mockCompressToBase64 = vi.fn();
const mockFetch = vi.fn();

vi.mock("@/lib/repo-cache", () => ({
  loadCache: (...a: unknown[]) => mockLoadCache(...a),
  saveCache: (...a: unknown[]) => mockSaveCache(...a),
}));
vi.mock("@/lib/bookmarks", () => ({
  saveBookmark: (...a: unknown[]) => mockSaveBookmark(...a),
}));
vi.mock("@/lib/compress-client", () => ({
  compressToBase64: (...a: unknown[]) => mockCompressToBase64(...a),
}));
vi.mock("@/lib/countries", () => ({
  isCountry: () => false,
  normalizeCountry: (s: string) => s,
}));

// Will be imported after mocks
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";
import type { ScanAction } from "@/hooks/useScanController";
import type { ScanStatus } from "@/hooks/use-repo-cache-loader";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LOCAL_CACHE = {
  points: [{ login: "alice", lat: 48, lng: 2, followers: 10, name: null, location: "Paris", company: null, bio: null, avatarUrl: null, starredAt: null }],
  unmapped: [],
  totalCount: 1,
  scannedAt: 1000,
  latestStarredAt: null,
};

const makeOpts = (overrides = {}) => ({
  owner: "test",
  repo: "repo",
  repoInfo: null,
  dispatch: vi.fn(),
  setTotal: vi.fn(),
  setCachedAt: vi.fn(),
  setLatestStarredAt: vi.fn(),
  setStatus: vi.fn(),
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useRepoCacheLoader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadCache.mockReturnValue(null);
    mockCompressToBase64.mockResolvedValue("gz==");
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  // ── localStorage hit ──────────────────────────────────────────────────────

  it("dispatches set + setStatus(cached) when localStorage has data", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledWith({
      type: "set",
      points: LOCAL_CACHE.points,
      unmapped: LOCAL_CACHE.unmapped,
    }));
    expect(opts.setStatus).toHaveBeenCalledWith("cached");
  });

  it("returns cacheCheckDone=true after DB fetch resolves", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
  });

  // ── DB 200, scannedMs > local ─────────────────────────────────────────────

  it("overwrites local cache when DB has newer data", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE); // scannedAt: 1000
    const dbPoints = [{ ...LOCAL_CACHE.points[0], login: "bob" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) {
        return jsonResponse({ points: dbPoints, unmapped: [], totalCount: 1, scannedAt: new Date(2000).toISOString(), latestStarredAt: null });
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledWith({
      type: "set",
      points: dbPoints,
      unmapped: [],
    }));
  });

  // ── DB 200, scannedMs <= local — MUST silently discard ────────────────────

  it("silently discards DB data when scannedMs <= local.scannedAt", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE); // scannedAt: 1000
    const oldDbPoints = [{ ...LOCAL_CACHE.points[0], login: "old" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) {
        return jsonResponse({ points: oldDbPoints, unmapped: [], totalCount: 1, scannedAt: new Date(500).toISOString(), latestStarredAt: null }); // 500 < 1000
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(opts.setCachedAt).toHaveBeenCalledWith(LOCAL_CACHE.scannedAt));
    // dispatch called only once (from localStorage), not from DB
    await waitFor(() => expect(opts.dispatch).toHaveBeenCalledTimes(1));
  });

  // ── DB 206 ────────────────────────────────────────────────────────────────

  it("sets lastDbScan from 206 when no local cache", async () => {
    mockLoadCache.mockReturnValue(null);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache")) return jsonResponse({ lastScan: "2026-01-01" }, 206);
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.lastDbScan).toBe("2026-01-01"));
  });

  it("calls donate when DB 206 + local cache exists", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache") && url.includes("/test/repo")) return jsonResponse({ lastScan: "x" }, 206);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(mockCompressToBase64).toHaveBeenCalled());
  });

  // ── DB 404 ────────────────────────────────────────────────────────────────

  it("calls donate when DB 404 + local cache exists", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("stargazer-cache") && url.includes("/test/repo")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(mockCompressToBase64).toHaveBeenCalled());
  });

  // ── DB down ───────────────────────────────────────────────────────────────

  it("sets cacheCheckDone=true even when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
  });
});
