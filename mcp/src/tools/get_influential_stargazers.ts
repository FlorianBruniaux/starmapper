// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchInfluentialStargazers } from "../client.js";

export const getInfluentialStargazers = async (
  args: { owner: string; repo: string; min_followers?: number },
): Promise<string> => {
  const minFollowers = args.min_followers ?? 500;
  const data = await fetchInfluentialStargazers(args.owner, args.repo, minFollowers);

  if (data.total === 0) {
    return `## Influential stargazers: ${args.owner}/${args.repo}\n\nNo stargazers found with ${minFollowers.toLocaleString()}+ followers. Try a lower threshold.`;
  }

  const rows = data.users
    .map((u, i) => {
      const location = u.location ? ` (${u.location})` : "";
      return `${i + 1}. @${u.login} - ${u.followers.toLocaleString()} followers${location}\n   ${u.profileUrl}`;
    })
    .join("\n");

  return [
    `## Influential stargazers: ${args.owner}/${args.repo}`,
    `Found ${data.total} users with ${minFollowers.toLocaleString()}+ followers`,
    ``,
    rows,
  ].join("\n");
};
