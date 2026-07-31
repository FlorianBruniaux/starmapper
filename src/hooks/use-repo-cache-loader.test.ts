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
  clearCache: vi.fn(),
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
    // LOCAL_CACHE.scannedAt=1000 (epoch). Make Date.now() return 1000+60s so the
    // cache appears fresh (60s old << MAX_LOCAL_AGE_MS 7d).
    vi.spyOn(Date, "now").mockReturnValue(LOCAL_CACHE.scannedAt + 60_000);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  // ── fallback chain: reconstruct / engaged ─────────────────────────────────

  it("falls back to /api/reconstruct when stargazer_cache 404s and no local cache", async () => {
    mockLoadCache.mockReturnValue(null);
    const reconstructPoints = [{ ...LOCAL_CACHE.points[0], login: "reconstructed-user" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/stargazer-cache/")) return new Response(null, { status: 404 });
      if (url.includes("/api/reconstruct/")) {
        return jsonResponse({ points: reconstructPoints, unmapped: [], totalCount: 1 });
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.dataSource).toBe("reconstructed"));
    expect(opts.dispatch).toHaveBeenCalledWith({ type: "set", points: reconstructPoints, unmapped: [] });
    expect(opts.setTotal).toHaveBeenCalledWith(1);
  });

  it("falls back to /api/engaged when both stargazer_cache and /api/reconstruct 404", async () => {
    mockLoadCache.mockReturnValue(null);
    const engagedPoints = [{ ...LOCAL_CACHE.points[0], login: "engaged-user" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/stargazer-cache/")) return new Response(null, { status: 404 });
      if (url.includes("/api/reconstruct/")) return new Response(null, { status: 404 });
      if (url.includes("/api/engaged/")) {
        return jsonResponse({ points: engagedPoints, unmapped: [], knownCount: 1, starCount: 500, channels: ["fork"] });
      }
      return new Response(null, { status: 404 });
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.dataSource).toBe("engaged"));
    expect(opts.dispatch).toHaveBeenCalledWith({ type: "set", points: engagedPoints, unmapped: [] });
    expect(opts.setTotal).toHaveBeenCalledWith(1);
  });

  it("dataSource stays null when every source 404s", async () => {
    mockLoadCache.mockReturnValue(null);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
    expect(result.current.dataSource).toBeNull();
  });

  it("does not attempt reconstruct/engaged fallback when local cache exists (donates instead)", async () => {
    mockLoadCache.mockReturnValue(LOCAL_CACHE);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/stargazer-cache/")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { result } = renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(mockCompressToBase64).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/reconstruct/"), expect.anything());
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/engaged/"), expect.anything());
    expect(result.current.dataSource).toBe("cache");
  });

  it("falls through to /api/engaged when /api/reconstruct fetch itself rejects (not just non-ok)", async () => {
    mockLoadCache.mockReturnValue(null);
    const engagedPoints = [{ ...LOCAL_CACHE.points[0], login: "engaged-after-reject" }];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/stargazer-cache/")) return Promise.resolve(new Response(null, { status: 404 }));
      if (url.includes("/api/reconstruct/")) return Promise.reject(new Error("network down"));
      if (url.includes("/api/engaged/")) {
        return jsonResponse({ points: engagedPoints, unmapped: [], knownCount: 1, starCount: 500, channels: ["fork"] });
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useRepoCacheLoader(opts));
    await waitFor(() => expect(result.current.dataSource).toBe("engaged"));
    expect(opts.dispatch).toHaveBeenCalledWith({ type: "set", points: engagedPoints, unmapped: [] });
  });

  it("dataSource is 'cache' when stargazer_cache 200s with fresh data", async () => {
    mockLoadCache.mockReturnValue(null);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/stargazer-cache/")) {
        return jsonResponse({ points: LOCAL_CACHE.points, unmapped: [], totalCount: 1, scannedAt: new Date(2000).toISOString(), latestStarredAt: null });
      }
      return new Response(null, { status: 404 });
    });
    const { result } = renderHook(() => useRepoCacheLoader(makeOpts()));
    await waitFor(() => expect(result.current.dataSource).toBe("cache"));
  });
});
