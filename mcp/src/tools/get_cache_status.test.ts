// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { getCacheStatus } = await import("./get_cache_status.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const statusResponse = (body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe("getCacheStatus", () => {
  test("returns not-indexed message when repo has no cache entry", async () => {
    mockFetch.mockReturnValueOnce(statusResponse({
      cached: false,
      scannedAt: null,
      totalCount: null,
      mappedCount: null,
    }));

    const result = await getCacheStatus({ owner: "vercel", repo: "next.js" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/mcp/cache-status/vercel/next.js",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toContain("Not indexed yet");
    expect(result).toContain("index_repo");
  });

  test("returns full metadata when repo is cached", async () => {
    mockFetch.mockReturnValueOnce(statusResponse({
      cached: true,
      scannedAt: "2026-06-01T10:00:00.000Z",
      totalCount: 45000,
      mappedCount: 38000,
    }));

    const result = await getCacheStatus({ owner: "facebook", repo: "react" });

    expect(result).toContain("yes");
    expect(result).toContain("45,000");
    expect(result).toContain("38,000");
  });

  test("returns partial info and prompt to index when badge-only entry", async () => {
    mockFetch.mockReturnValueOnce(statusResponse({
      cached: false,
      scannedAt: "2026-05-15T08:00:00.000Z",
      totalCount: 12000,
      mappedCount: 9000,
    }));

    const result = await getCacheStatus({ owner: "owner", repo: "repo" });

    expect(result).toContain("partial");
    expect(result).toContain("index_repo");
  });
});
