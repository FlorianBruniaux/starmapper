// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
  fetchGlobalCountryStats: vi.fn(),
}));

import { fetchGlobalCountryStats } from "../client.js";
import { getGlobalCountryStats } from "./get_global_country_stats.js";

const baseData = {
  countries: [
    { name: "United States", count: 500000, slug: "united-states" },
    { name: "China", count: 300000, slug: "china" },
    { name: "India", count: 200000, slug: "india" },
  ],
  totalCountries: 3,
  totalStargazers: 1000000,
  generatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGlobalCountryStats()", () => {
  it("renders country table with formatted counts", async () => {
    vi.mocked(fetchGlobalCountryStats).mockResolvedValue(baseData);
    const result = await getGlobalCountryStats();
    expect(result).toContain("United States");
    expect(result).toContain("500.0k");
    expect(result).toContain("China");
    expect(result).toContain("India");
  });

  it("shows total stargazers and country count in header", async () => {
    vi.mocked(fetchGlobalCountryStats).mockResolvedValue(baseData);
    const result = await getGlobalCountryStats();
    expect(result).toContain("1000.0k");
    expect(result).toContain("3");
    expect(result).toContain("countries");
  });

  it("returns empty-data message when no countries in MV", async () => {
    vi.mocked(fetchGlobalCountryStats).mockResolvedValue({
      countries: [],
      totalCountries: 0,
      totalStargazers: 0,
      generatedAt: "2026-01-01T00:00:00Z",
    });
    const result = await getGlobalCountryStats();
    expect(result).toContain("No data available");
  });
});
