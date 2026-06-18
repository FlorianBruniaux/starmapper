// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchFollowersMcp } from "../client.js";

const formatCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const getFollowers = async (args: { login: string }): Promise<string> => {
  const data = await fetchFollowersMcp(args.login);

  if (data.followers.length === 0) {
    return [
      `## Followers of @${data.login}`,
      ``,
      `No followers found, or the account does not exist.`,
    ].join("\n");
  }

  const tableHeader = "| User | Followers | Company | Location |";
  const tableDivider = "|---|---:|---|---|";
  const tableRows = data.followers.map((f) =>
    `| [@${f.login}](${f.profileUrl}) | ${formatCount(f.followers)} | ${f.company ?? "-"} | ${f.location ?? "-"} |`,
  );

  const truncationNote = data.truncated
    ? `\n> Showing ${formatCount(data.shownCount)} most influential of ${formatCount(data.totalCount)} total followers (sorted by follower count)`
    : `\n> ${formatCount(data.totalCount)} follower${data.totalCount !== 1 ? "s" : ""} total`;

  return [
    `## Followers of @${data.login} (${formatCount(data.totalCount)} total, showing ${data.shownCount})`,
    ``,
    tableHeader,
    tableDivider,
    ...tableRows,
    truncationNote,
  ].join("\n");
};
