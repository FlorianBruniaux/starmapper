// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchListRepos } from "../client.js";

export const listRepos = async (args: { limit?: number }): Promise<string> => {
  const limit = Math.min(args.limit ?? 50, 200);
  const { repos, total } = await fetchListRepos(limit);

  if (repos.length === 0) {
    return "No repos indexed on StarMapper yet.";
  }

  const rows = repos
    .map(
      (r, i) =>
        `${i + 1}. ${r.owner}/${r.repo} — ${r.mappedCount.toLocaleString("en-US")} geocoded / ${r.totalCount.toLocaleString("en-US")} total (${r.mappedPercent}% mapping rate, ${r.countryCount} countries)`,
    )
    .join("\n");

  return [
    `## Indexed repos on StarMapper`,
    `Showing ${repos.length} of ${total} repos`,
    ``,
    rows,
  ].join("\n");
};
