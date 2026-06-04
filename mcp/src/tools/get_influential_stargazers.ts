// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchInfluentialStargazers } from "../client.js";

export const GET_INFLUENTIAL_SCHEMA = {
  name: "get_influential_stargazers",
  description:
    "List stargazers of a GitHub repository above a follower threshold. Useful for finding VIP users to engage with for a product launch or announcement.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
      min_followers: {
        type: "number",
        description: "Minimum follower count. Use 500, 1000, or 5000. Defaults to 500.",
        enum: [500, 1000, 5000],
      },
    },
    required: ["owner", "repo"],
  },
};

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
