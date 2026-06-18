// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchContributorsMcp } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getContributors = async (args: {
  owner: string;
  repo: string;
  with_locations?: boolean;
}): Promise<string> => {
  const data = await fetchContributorsMcp(args.owner, args.repo, args.with_locations ?? false);

  if (data.computing) {
    return [
      `## Contributors: ${args.owner}/${args.repo}`,
      ``,
      `GitHub is still computing contributor statistics for this repository. Retry in a few seconds.`,
    ].join("\n");
  }

  if (data.contributors.length === 0) {
    return [
      `## Contributors: ${args.owner}/${args.repo}`,
      ``,
      `No contributors found. The repository may not be indexed yet — run \`index_repo\` first.`,
    ].join("\n");
  }

  const rows = data.contributors.map((c, i) => {
    const loc = c.location ? ` — ${c.location}` : "";
    return `${i + 1}. [@${c.login}](${c.profileUrl}) — ${formatCount(c.contributions)} contributions${loc}`;
  });

  const moreNote = data.hasMore
    ? `\n> Showing top ${data.shownCount} contributors (repository may have more)`
    : `\n> ${data.shownCount} contributor${data.shownCount !== 1 ? "s" : ""} total`;

  return [
    `## Contributors: ${args.owner}/${args.repo}`,
    ``,
    ...rows,
    moreNote,
    ``,
    `[View on StarMapper](${data.mapUrl})`,
  ].join("\n");
};
