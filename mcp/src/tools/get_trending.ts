// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchTrending } from "../client.js";

export const getTrending = async (): Promise<string> => {
  const { repos, meta } = await fetchTrending();

  if (repos.length === 0) {
    return "No trending repos found. The trending materialized view may not be initialized yet.";
  }

  const rows = repos
    .slice(0, 20)
    .map((r, i) => {
      const lang = r.language ? ` [${r.language}]` : "";
      return `${i + 1}. ${r.owner}/${r.repo}${lang} — +${r.stars7d.toLocaleString("en-US")} stars/7d, +${r.stars30d.toLocaleString("en-US")}/30d`;
    })
    .join("\n");

  return [
    `## Trending repos on StarMapper`,
    `${meta.total} repos indexed, showing top ${Math.min(repos.length, 20)}`,
    ``,
    rows,
  ].join("\n");
};
