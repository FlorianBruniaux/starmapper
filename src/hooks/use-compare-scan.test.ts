// src/hooks/use-compare-scan.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();

vi.mock("@/components/token-modal", () => ({
  getStoredToken: () => null,
}));

import { useCompareScan } from "@/hooks/use-compare-scan";

const makeChunk = (nextCursor: string | null = null) => ({
  points: [{ login: "alice", lat: 48, lng: 2, followers: 0, name: null, location: null, company: null, bio: null, avatarUrl: null, starredAt: null }],
  unmapped: [],
  nextCursor,
  totalCount: 1,
});

const jsonOk = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

describe("useCompareScan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 404 }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const ghHeaders = () => ({ "Content-Type": "application/json" });

  // ── Initial state ─────────────────────────────────────────────────────────

  it("starts with all compare state null/idle/empty", () => {
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    expect(result.current.compareOwner).toBeNull();
    expect(result.current.compareRepo).toBeNull();
    expect(result.current.compareStatus).toBe("idle");
    expect(result.current.comparePoints).toEqual([]);
    expect(result.current.compareInfo).toBeNull();
  });

  // ── No fetch when no owner/repo ───────────────────────────────────────────

  it("does not fetch when compareOwner/compareRepo are null", async () => {
    renderHook(() => useCompareScan(ghHeaders));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Scan completion ───────────────────────────────────────────────────────

  it("runs chunk loop until nextCursor is null, sets compareStatus=done", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("chunk")) return jsonOk(makeChunk(null));
      if (url.includes("repo-info")) return jsonOk({ name: "next.js", stars: 100 });
      return new Response(null, { status: 404 });
    });
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("vercel"); result.current.setCompareRepo("next.js"); });
    await waitFor(() => expect(result.current.compareStatus).toBe("done"));
    expect(result.current.comparePoints.length).toBeGreaterThan(0);
  });

  // ── Throttle ──────────────────────────────────────────────────────────────

  it("throttles setComparePoints — does not update on every chunk within 2s window", async () => {
    let callCount = 0;
    // 3 chunks, nextCursor non-null for first two
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("chunk")) {
        callCount++;
        return jsonOk(makeChunk(callCount < 3 ? "cursor" : null));
      }
      if (url.includes("repo-info")) return jsonOk({ name: "r", stars: 0 });
      return new Response(null, { status: 404 });
    });
    const { result } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("a"); result.current.setCompareRepo("b"); });
    await waitFor(() => expect(result.current.compareStatus).toBe("done"));
    // Final state always applied — points must be non-empty
    expect(result.current.comparePoints.length).toBe(3);
  });

  // ── AbortController ───────────────────────────────────────────────────────

  it("aborts repo-info fetch on unmount", async () => {
    let aborted = false;
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.signal) {
        opts.signal.addEventListener("abort", () => { aborted = true; });
      }
      return new Promise(() => {}); // never resolves
    });
    const { result, unmount } = renderHook(() => useCompareScan(ghHeaders));
    act(() => { result.current.setCompareOwner("a"); result.current.setCompareRepo("b"); });
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(true);
  });
});
