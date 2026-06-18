// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchRepoStats } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getCountryStats = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchRepoStats(args.owner, args.repo);

  if (data.mappedCount === 0) {
    return [
      `## Country stats: ${args.owner}/${args.repo}`,
      ``,
      `No geocoded data found. Run \`index_repo\` first to scan this repository.`,
    ].join("\n");
  }

  const countryTableHeader = "| Country | Stargazers |";
  const countryTableDivider = "|---|---:|";
  const countryRows = data.topCountries.map(
    ([country, count]) => `| ${country} | ${formatCount(count)} |`,
  );

  const cityTableHeader = "| City | Stargazers |";
  const cityTableDivider = "|---|---:|";
  const cityRows = data.topCities.map(
    ([city, count]) => `| ${city} | ${formatCount(count)} |`,
  );

  return [
    `## Country stats: ${args.owner}/${args.repo}`,
    ``,
    `**${formatCount(data.mappedCount)}** geocoded out of **${formatCount(data.totalStars)}** total stars — ${data.countryCount} countries`,
    ``,
    `### By country`,
    countryTableHeader,
    countryTableDivider,
    ...countryRows,
    ``,
    `### Top cities`,
    cityTableHeader,
    cityTableDivider,
    ...cityRows,
  ].join("\n");
};
