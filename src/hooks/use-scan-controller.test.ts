// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScanController } from "./useScanController";
import type { ScanState } from "./useScanController";
import { useContributorsScanController } from "./useContributorsScanController";

vi.mock("@/lib/compress-client", () => ({
  compressToBase64: async () => "compressed",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("scan controller callback updates", () => {
  it("reports an invalid contributors token through the latest callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "github_token_invalid" }), { status: 401 },
    )));
    const options = {
      owner: "test",
      repo: "repo",
      dispatch: vi.fn(),
      setTotal: vi.fn(),
      setTokenOpen: vi.fn(),
      setHasToken: vi.fn(),
      ghHeaders: () => ({}),
    };
    const { result, rerender } = renderHook((props) => useContributorsScanController(props), { initialProps: options });
    const setHasToken = vi.fn();
    rerender({ ...options, setHasToken });

    await act(async () => { await result.current.startScraping(); });
    expect(setHasToken).toHaveBeenCalledWith(false);
    expect(options.setHasToken).not.toHaveBeenCalled();
  });

  it("persists current repository metadata after a refresh", async () => {
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url === "/api/chunk") return new Response(JSON.stringify({
        points: [], unmapped: [], nextCursor: null, totalCount: 1,
        latestStarredAt: null, quotaRemaining: null,
      }));
      if (url === "/api/stats/test/repo") return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const scan: ScanState = {
      points: [{
        login: "alice", name: null, bio: null, company: null, location: "Paris",
        followers: 10, avatarUrl: "", lat: 48, lng: 2, starredAt: null, linkedinUrl: null,
      }],
      unmapped: [],
      processed: 1,
    };
    const options = {
      owner: "test", repo: "repo", dispatch: vi.fn(), scanRef: { current: scan },
      setTotal: vi.fn(), setCachedAt: vi.fn(), setLatestStarredAt: vi.fn(),
      setTokenOpen: vi.fn(), setHasToken: vi.fn(), setServerStats: vi.fn(),
      ghHeaders: () => ({}), repoInfo: { language: "Go", forksCount: 1, watchersCount: 2 },
      total: 1, latestStarredAt: "2026-01-01T00:00:00Z",
    };
    const { result, rerender } = renderHook((props) => useScanController(props), { initialProps: options });
    rerender({ ...options, repoInfo: { language: "Rust", forksCount: 3, watchersCount: 4 } });

    await act(async () => { await result.current.startRefresh(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/badge-update", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ owner: "test", repo: "repo", mappedCount: 1, countryCount: 0, totalCount: 1, language: "Rust", forksCount: 3, watchersCount: 4 }),
    })));
  });
});
