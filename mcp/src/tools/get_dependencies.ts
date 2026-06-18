// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchDependenciesMcp } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getDependencies = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchDependenciesMcp(args.owner, args.repo);

  if (data.disabled) {
    return [
      `## Dependencies: ${args.owner}/${args.repo}`,
      ``,
      `The dependency graph is not enabled for this repository, or the data is not accessible.`,
      `Enable it at: https://github.com/${args.owner}/${args.repo}/settings/security_analysis`,
    ].join("\n");
  }

  if (data.dependencies.length === 0) {
    return [
      `## Dependencies: ${args.owner}/${args.repo}`,
      ``,
      `No dependencies found in the dependency graph.`,
    ].join("\n");
  }

  const tableHeader = "| Package | Ecosystem | Version |";
  const tableDivider = "|---|---|---|";
  const tableRows = data.dependencies.slice(0, 20).map(
    (d) => `| ${d.name} | ${d.ecosystem ?? "-"} | ${d.version ?? "-"} |`,
  );

  const truncationNote = data.truncated
    ? `\n> Showing 20 of ${formatCount(data.shownCount)} fetched (${formatCount(data.totalCount)} total dependencies)`
    : `\n> ${data.shownCount} dependenc${data.shownCount !== 1 ? "ies" : "y"} declared`;

  return [
    `## Dependencies: ${args.owner}/${args.repo}`,
    ``,
    `**${formatCount(data.totalCount)}** dependencies declared in the dependency graph.`,
    ``,
    tableHeader,
    tableDivider,
    ...tableRows,
    truncationNote,
  ].join("\n");
};
