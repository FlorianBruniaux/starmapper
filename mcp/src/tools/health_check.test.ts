// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { healthCheck } = await import("./health_check.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("healthCheck", () => {
  test("reports api ok and token status", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await healthCheck();

    expect(result).toContain("ok");
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("https://starmapper.test");
  });

  test("reports unreachable when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const result = await healthCheck();

    expect(result).toContain("unreachable");
    expect(result).toContain("STARMAPPER_BASE_URL");
  });
});
