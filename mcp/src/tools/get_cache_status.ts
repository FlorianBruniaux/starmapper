// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchCacheStatus } from "../client.js";

export const getCacheStatus = async (args: { owner: string; repo: string }): Promise<string> => {
  const status = await fetchCacheStatus(args.owner, args.repo);

  if (!status.cached && status.scannedAt === null) {
    return [
      `## ${args.owner}/${args.repo}`,
      ``,
      `Not indexed yet. Run \`index_repo\` to geocode all stargazers.`,
    ].join("\n");
  }

  const lines = [
    `## ${args.owner}/${args.repo}`,
    ``,
    `Cached: ${status.cached ? "yes (full stargazer map available)" : "partial (badge data only, no map)"}`,
    `Last scan: ${status.scannedAt ? new Date(status.scannedAt).toLocaleString() : "unknown"}`,
    `Total stars: ${status.totalCount?.toLocaleString("en-US") ?? "unknown"}`,
    `Geocoded: ${status.mappedCount?.toLocaleString("en-US") ?? "unknown"}`,
  ];

  if (!status.cached) {
    lines.push(``, `Run \`index_repo\` to build the full stargazer map.`);
  }

  return lines.join("\n");
};
