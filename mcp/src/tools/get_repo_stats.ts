// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchRepoStats } from "../client.js";

export const getRepoStats = async (args: { owner: string; repo: string }): Promise<string> => {
  const stats = await fetchRepoStats(args.owner, args.repo);

  const topCountries = stats.topCountries
    .slice(0, 10)
    .map(([country, count], i) => `${i + 1}. ${country}: ${count.toLocaleString()}`)
    .join("\n");

  const topCities = stats.topCities
    .slice(0, 10)
    .map(([city, count], i) => `${i + 1}. ${city}: ${count.toLocaleString()}`)
    .join("\n");

  const organicLine = stats.organic
    ? `Organic score: ${stats.organic.score ?? "N/A"}/100 (${stats.organic.tier}), last computed ${stats.organic.computedAt ? new Date(stats.organic.computedAt).toLocaleDateString() : "never"}`
    : "Organic score: not yet computed";

  return [
    `## ${args.owner}/${args.repo}`,
    ``,
    `Stars: ${stats.totalStars.toLocaleString()} total, ${stats.mappedCount.toLocaleString()} geocoded (${stats.mappingRate}% mapping rate)`,
    `Countries represented: ${stats.countryCount}`,
    `Average follower count: ${stats.avgFollowers.toLocaleString()}`,
    organicLine,
    ``,
    `### Top 10 countries`,
    topCountries || "No country data yet.",
    ``,
    `### Top 10 cities`,
    topCities || "No city data yet.",
  ].join("\n");
};
