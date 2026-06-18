// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchGlobalCountryStats } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getGlobalCountryStats = async (): Promise<string> => {
  const data = await fetchGlobalCountryStats();

  if (data.countries.length === 0) {
    return [
      `## Global stargazer distribution by country`,
      ``,
      `No data available yet. The materialized view may not have been populated.`,
    ].join("\n");
  }

  const tableHeader = "| Country | Stargazers |";
  const tableDivider = "|---|---:|";
  const tableRows = data.countries.map(
    (c) => `| ${c.name} | ${formatCount(c.count)} |`,
  );

  return [
    `## Global stargazer distribution by country`,
    ``,
    `**${formatCount(data.totalStargazers)}** geocoded stargazers across **${data.totalCountries}** countries (all indexed repos combined)`,
    ``,
    tableHeader,
    tableDivider,
    ...tableRows,
  ].join("\n");
};
