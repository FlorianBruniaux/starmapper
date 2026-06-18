// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
  fetchRepoStats: vi.fn(),
}));

import { fetchRepoStats } from "../client.js";
import { getCountryStats } from "./get_country_stats.js";

const baseData = {
  totalStars: 50000,
  mappedCount: 40000,
  mappingRate: 0.8,
  avgFollowers: 250,
  countryCount: 80,
  topCountries: [["United States", 12000], ["Germany", 5000], ["France", 3000]] as [string, number][],
  topCities: [["New York", 2000], ["Berlin", 1500]] as [string, number][],
  organic: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCountryStats()", () => {
  it("renders country table with formatted counts", async () => {
    vi.mocked(fetchRepoStats).mockResolvedValue(baseData);
    const result = await getCountryStats({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("United States");
    expect(result).toContain("12.0k");
    expect(result).toContain("Germany");
    expect(result).toContain("France");
  });

  it("renders city table", async () => {
    vi.mocked(fetchRepoStats).mockResolvedValue(baseData);
    const result = await getCountryStats({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("New York");
    expect(result).toContain("Berlin");
  });

  it("shows total stars and mapped count in header", async () => {
    vi.mocked(fetchRepoStats).mockResolvedValue(baseData);
    const result = await getCountryStats({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("40.0k");
    expect(result).toContain("50.0k");
    expect(result).toContain("80 countries");
  });

  it("returns not-indexed message when mappedCount is 0", async () => {
    vi.mocked(fetchRepoStats).mockResolvedValue({ ...baseData, mappedCount: 0 });
    const result = await getCountryStats({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("index_repo");
  });
});
