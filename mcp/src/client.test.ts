// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { fetchRepoStats, fetchOrganicScore, fetchVelocity, fetchInfluentialStargazers, triggerChunk } =
  await import("./client.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); });

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const notFound = () =>
  Promise.resolve(new Response(JSON.stringify({ error: "no_data" }), { status: 404 }));

describe("fetchRepoStats", () => {
  test("calls correct URL and returns typed data", async () => {
    const payload = { totalStars: 5000, mappedCount: 4200, topCountries: [["US", 1500]] };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await fetchRepoStats("vercel", "next.js");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/stats/vercel/next.js",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.totalStars).toBe(5000);
    expect(result.mappedCount).toBe(4200);
  });

  test("throws on non-ok response", async () => {
    mockFetch.mockReturnValueOnce(notFound());
    await expect(fetchRepoStats("owner", "repo")).rejects.toThrow("StarMapper API error 404");
  });
});

describe("fetchOrganicScore", () => {
  test("calls /api/mcp/organic-score/ and returns signals", async () => {
    const payload = { score: 72, tier: "healthy", tierLabel: "Healthy", signals: { forkRatio: 0.1 } };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await fetchOrganicScore("owner", "repo");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/mcp/organic-score/owner/repo",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.tier).toBe("healthy");
  });
});

describe("fetchVelocity", () => {
  test("calls /api/stats/[owner]/[repo]/geo-velocity", async () => {
    mockFetch.mockReturnValueOnce(ok({ items: [], timedOut: false }));
    const result = await fetchVelocity("owner", "repo");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/stats/owner/repo/geo-velocity",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.items).toEqual([]);
  });
});

describe("fetchInfluentialStargazers", () => {
  test("calls /api/mcp/influential/ with minFollowers query param", async () => {
    mockFetch.mockReturnValueOnce(ok({ users: [], total: 0, minFollowers: 1000 }));
    await fetchInfluentialStargazers("owner", "repo", 1000);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/mcp/influential/owner/repo?minFollowers=1000",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("triggerChunk", () => {
  test("calls POST /api/chunk with correct body (no cursor)", async () => {
    mockFetch.mockReturnValueOnce(ok({ points: [], unmapped: [], nextCursor: null, totalCount: 0 }));
    const result = await triggerChunk("owner", "repo", null);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner: "owner", repo: "repo" }),
      })
    );
    expect(result.nextCursor).toBeNull();
  });

  test("passes cursor in body when provided", async () => {
    mockFetch.mockReturnValueOnce(ok({ points: [], unmapped: [], nextCursor: "abc123", totalCount: 200 }));
    await triggerChunk("owner", "repo", "cursor_val");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        body: JSON.stringify({ owner: "owner", repo: "repo", cursor: "cursor_val" }),
      })
    );
  });
});
