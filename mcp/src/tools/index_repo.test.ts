// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { indexRepo } = await import("./index_repo.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const chunkResponse = (
  points: { login: string; lat: number; lng: number }[],
  nextCursor: string | null,
  totalCount: number,
) =>
  Promise.resolve(
    new Response(
      JSON.stringify({ points, unmapped: [], nextCursor, totalCount }),
      { status: 200 }
    )
  );

const cacheResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));

// fetchSmToken always calls GET / first; return a response with no Set-Cookie header
// so smToken resolves to null and the rest of the test mocks run in order.
const homepageResponse = () =>
  Promise.resolve(new Response("", { status: 200 }));

describe("indexRepo", () => {
  test("calls chunk loop until nextCursor is null and returns summary", async () => {
    mockFetch
      .mockReturnValueOnce(homepageResponse())
      .mockReturnValueOnce(chunkResponse(
        [{ login: "alice", lat: 48.8, lng: 2.3 }], "cursor_1", 2
      ))
      .mockReturnValueOnce(chunkResponse(
        [{ login: "bob", lat: 37.7, lng: -122.4 }], null, 2
      ))
      .mockReturnValueOnce(cacheResponse());

    const result = await indexRepo({ owner: "owner", repo: "repo" });

    expect(mockFetch).toHaveBeenCalledTimes(4);

    expect(mockFetch).toHaveBeenNthCalledWith(2,
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner: "owner", repo: "repo" }),
      })
    );

    expect(mockFetch).toHaveBeenNthCalledWith(3,
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        body: JSON.stringify({ owner: "owner", repo: "repo", cursor: "cursor_1" }),
      })
    );

    expect(result).toContain("Indexed 2 users");
    expect(result).toContain("owner/repo");
  });

  test("returns error message when chunk call fails", async () => {
    mockFetch
      .mockReturnValueOnce(homepageResponse())
      .mockReturnValueOnce(Promise.resolve(new Response("{}", { status: 500 })));

    const result = await indexRepo({ owner: "owner", repo: "repo" });
    expect(result).toContain("Error");
  });

  test("returns warning when totalCount is 0", async () => {
    mockFetch
      .mockReturnValueOnce(homepageResponse())
      .mockReturnValueOnce(chunkResponse([], null, 0));

    const result = await indexRepo({ owner: "owner", repo: "repo" });
    expect(result).toContain("0 stars");
  });
});
