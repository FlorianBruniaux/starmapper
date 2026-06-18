// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
  fetchFollowersMcp: vi.fn(),
}));

import { fetchFollowersMcp } from "../client.js";
import { getFollowers } from "./get_followers.js";

const baseData = {
  login: "gaearon",
  followers: [
    { login: "kentcdodds", name: "Kent C. Dodds", followers: 95000, company: "Epicweb.dev", location: "Utah, USA", profileUrl: "https://github.com/kentcdodds" },
    { login: "sindresorhus", name: "Sindre Sorhus", followers: 80000, company: null, location: "Thailand", profileUrl: "https://github.com/sindresorhus" },
  ],
  shownCount: 2,
  totalCount: 2,
  truncated: false,
  fetchedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFollowers()", () => {
  it("renders follower table with formatted counts", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue(baseData);
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("kentcdodds");
    expect(result).toContain("95.0k");
    expect(result).toContain("sindresorhus");
    expect(result).toContain("Thailand");
  });

  it("shows company and location columns", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue(baseData);
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("Epicweb.dev");
    expect(result).toContain("Utah, USA");
  });

  it("uses dash placeholder for missing company and location", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue({
      ...baseData,
      followers: [{ login: "anon", name: null, followers: 10, company: null, location: null, profileUrl: "https://github.com/anon" }],
      shownCount: 1,
      totalCount: 1,
    });
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("| - | - |");
  });

  it("returns empty message when no followers", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue({ ...baseData, followers: [], shownCount: 0, totalCount: 0 });
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("No followers found");
  });

  it("notes truncation when totalCount exceeds shownCount", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue({
      ...baseData,
      shownCount: 100,
      totalCount: 5000,
      truncated: true,
    });
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("5.0k total followers");
  });

  it("includes login in the header", async () => {
    vi.mocked(fetchFollowersMcp).mockResolvedValue(baseData);
    const result = await getFollowers({ login: "gaearon" });
    expect(result).toContain("@gaearon");
  });
});
