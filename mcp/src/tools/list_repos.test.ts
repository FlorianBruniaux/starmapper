// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { listRepos } = await import("./list_repos.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const reposResponse = (repos: object[], total: number) =>
  Promise.resolve(
    new Response(JSON.stringify({ repos, total }), { status: 200 }),
  );

describe("listRepos", () => {
  test("returns formatted list with geocoded count and countries", async () => {
    mockFetch.mockReturnValueOnce(
      reposResponse(
        [
          { owner: "torvalds", repo: "linux", mappedCount: 8500, countryCount: 92, totalCount: 12000, mappedPercent: 71 },
          { owner: "microsoft", repo: "vscode", mappedCount: 32000, countryCount: 140, totalCount: 45000, mappedPercent: 71 },
        ],
        2,
      ),
    );

    const result = await listRepos({ limit: 10 });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/repos?limit=10",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toContain("torvalds/linux");
    expect(result).toContain("8,500");
    expect(result).toContain("92 countries");
    expect(result).toContain("microsoft/vscode");
  });

  test("defaults to limit=50 when not specified", async () => {
    mockFetch.mockReturnValueOnce(reposResponse([], 0));
    await listRepos({});
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/repos?limit=50",
      expect.anything(),
    );
  });

  test("returns fallback message when no repos", async () => {
    mockFetch.mockReturnValueOnce(reposResponse([], 0));
    const result = await listRepos({});
    expect(result).toContain("No repos indexed");
  });
});
