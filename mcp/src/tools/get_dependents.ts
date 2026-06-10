// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchDependentsMcp } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getDependents = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchDependentsMcp(args.owner, args.repo);

  const packageSummary = data.packages
    .slice(0, 3)
    .map((p) => `${p.name} (${p.ecosystem}, ${formatCount(p.dependentReposCount)} dependent repos)`)
    .join(", ");

  const tableHeader = "| Repository | Language | Stars | Forks |";
  const tableDivider = "|---|---|---:|---:|";
  const tableRows = data.topDependents.slice(0, 20).map((d) =>
    `| [${d.fullName}](${d.htmlUrl}) | ${d.language ?? "-"} | ${formatCount(d.stars)} | ${formatCount(d.forks)} |`,
  );

  const truncationNote = data.truncated
    ? `\n> Showing top 20 of ${formatCount(data.shownCount)} fetched (${formatCount(data.totalCount)} total dependent repos across all ecosystems)`
    : `\n> ${data.shownCount} dependent repo${data.shownCount !== 1 ? "s" : ""} found`;

  return [
    `## Dependents: ${args.owner}/${args.repo}`,
    ``,
    `**${formatCount(data.totalCount)}** repos depend on this library.`,
    packageSummary ? `Published as: ${packageSummary}` : "",
    `Last fetched: ${new Date(data.fetchedAt).toLocaleDateString()}`,
    ``,
    `### Top dependents by stars`,
    tableHeader,
    tableDivider,
    ...tableRows,
    truncationNote,
    ``,
    `[View full dependents list on StarMapper](${data.mapUrl})`,
  ].filter((line) => line !== undefined).join("\n");
};
