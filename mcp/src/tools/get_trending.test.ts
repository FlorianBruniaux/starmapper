// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { getTrending } = await import("./get_trending.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const trendingResponse = (repos: object[]) =>
  Promise.resolve(
    new Response(JSON.stringify({ repos, meta: { total: repos.length } }), { status: 200 }),
  );

describe("getTrending", () => {
  test("returns formatted list of trending repos", async () => {
    mockFetch.mockReturnValueOnce(
      trendingResponse([
        { owner: "vercel", repo: "next.js", language: "TypeScript", stars7d: 1500, stars30d: 5200, stars90d: 14000, totalCount: 120000, mappedCount: 98000 },
        { owner: "facebook", repo: "react", language: "JavaScript", stars7d: 900, stars30d: 3100, stars90d: 9500, totalCount: 220000, mappedCount: 180000 },
      ]),
    );

    const result = await getTrending();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/trending/repos",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toContain("vercel/next.js");
    expect(result).toContain("1,500");
    expect(result).toContain("TypeScript");
    expect(result).toContain("facebook/react");
  });

  test("returns fallback message when no repos", async () => {
    mockFetch.mockReturnValueOnce(
      trendingResponse([]),
    );

    const result = await getTrending();
    expect(result).toContain("No trending repos");
  });
});
