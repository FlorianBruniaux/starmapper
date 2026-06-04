// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchVelocity } from "../client.js";

export const GET_VELOCITY_SCHEMA = {
  name: "get_velocity",
  description:
    "Get per-country star velocity for a GitHub repository: rising, new, stable, or declining over the last 30 days vs the 31-90 day window. Useful for spotting geographic trends after a launch or blog post.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
    },
    required: ["owner", "repo"],
  },
};

const TREND_LABEL: Record<string, string> = {
  rising: "up",
  new: "new",
  stable: "stable",
  declining: "down",
};

export const getVelocity = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchVelocity(args.owner, args.repo);

  if (data.timedOut) {
    return `## Velocity: ${args.owner}/${args.repo}\n\nData temporarily unavailable (database timeout). Try again in a few minutes.`;
  }

  if (data.items.length === 0) {
    return `## Velocity: ${args.owner}/${args.repo}\n\nNo velocity data available. The repository may not have enough recent star events with timestamped data.`;
  }

  const rows = data.items
    .map((item) => {
      const label = TREND_LABEL[item.trend] ?? item.trend;
      return `[${label}] ${item.country.padEnd(20)} +${item.stars30d} last 30d | ratio ${item.ratio}x`;
    })
    .join("\n");

  return [
    `## Star velocity: ${args.owner}/${args.repo}`,
    `(last 30 days vs 31-90 day window)`,
    ``,
    rows,
  ].join("\n");
};
