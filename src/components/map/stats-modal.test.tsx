// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatsModal } from "@/components/map/stats-modal";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";

// Engaged-audience points carry no location and no company, so every location-derived
// aggregate computes to 0. A visible "0 countries" over a populated map reads as a bug.
const EMPTY_LOCATION_STATS: RepoStats = {
  totalStars: 400,
  mappedCount: 120,
  mappingRate: 30,
  avgFollowers: 42,
  countryCount: 0,
  topCountries: [],
  topCities: [],
  topCompanies: [],
  topUsers: [
    { login: "octocat", name: "Octo", followers: 900, publicRepos: 12, location: null, avatarUrl: "https://github.com/octocat.png", company: null },
  ],
  powerStargazers: [],
  botCount: 0,
  enrichedUserCount: 0,
  isCapped: false,
  organic: null,
};

const noop = () => {};

describe("StatsModal", () => {
  it("shows country/city/company views by default", () => {
    render(
      <StatsModal open onClose={noop} owner="o" repo="r" displayStats={EMPTY_LOCATION_STATS} starsThisMonth={0} />,
    );
    expect(screen.getByRole("tab", { name: "Countries" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cities" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Companies" })).toBeInTheDocument();
    expect(screen.getByText("countries")).toBeInTheDocument();
  });

  it("hides location-derived tabs and tiles when the source has no location data", () => {
    render(
      <StatsModal open onClose={noop} owner="o" repo="r" displayStats={EMPTY_LOCATION_STATS} starsThisMonth={0} hideLocationAggregates />,
    );
    expect(screen.queryByRole("tab", { name: "Countries" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Cities" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Companies" })).toBeNull();
    expect(screen.queryByText("countries")).toBeNull();
    expect(screen.queryByText("cities")).toBeNull();
    // Follower-based views stay: they are the ones engaged data can actually fill.
    expect(screen.getByRole("tab", { name: "Top Stars" })).toBeInTheDocument();
    expect(screen.getByText("avg flw")).toBeInTheDocument();
  });
});
