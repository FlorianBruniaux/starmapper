// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
  fetchContributorsMcp: vi.fn(),
}));

import { fetchContributorsMcp } from "../client.js";
import { getContributors } from "./get_contributors.js";

const baseData = {
  contributors: [
    { login: "gaearon", contributions: 2500, location: "New York", profileUrl: "https://github.com/gaearon" },
    { login: "timneutkens", contributions: 1800, location: null, profileUrl: "https://github.com/timneutkens" },
  ],
  shownCount: 2,
  hasMore: false,
  computing: false,
  fetchedAt: "2026-01-01T00:00:00Z",
  mapUrl: "https://starmapper.bruniaux.com/vercel/next.js",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getContributors()", () => {
  it("returns contributor list with contributions and location", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue(baseData);
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("gaearon");
    expect(result).toContain("2.5k contributions");
    expect(result).toContain("New York");
    expect(result).toContain("timneutkens");
  });

  it("omits location when null", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue(baseData);
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    // timneutkens has no location so no extra dash should appear for them
    expect(result).not.toContain("timneutkens — 1.8k contributions —");
  });

  it("returns computing message when GitHub is still computing stats", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue({
      ...baseData,
      computing: true,
      contributors: [],
      shownCount: 0,
    });
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("still computing");
  });

  it("returns empty message when no contributors found", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue({
      ...baseData,
      contributors: [],
      shownCount: 0,
    });
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("No contributors found");
  });

  it("notes when more contributors exist beyond the shown count", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue({ ...baseData, hasMore: true });
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("may have more");
  });

  it("includes StarMapper map URL", async () => {
    vi.mocked(fetchContributorsMcp).mockResolvedValue(baseData);
    const result = await getContributors({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("starmapper.bruniaux.com/vercel/next.js");
  });
});
