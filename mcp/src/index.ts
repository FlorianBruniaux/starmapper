// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper MCP server - stdio transport, exposes 5 tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getRepoStats } from "./tools/get_repo_stats.js";
import { getOrganicScore } from "./tools/get_organic_score.js";
import { getVelocity } from "./tools/get_velocity.js";
import { getInfluentialStargazers } from "./tools/get_influential_stargazers.js";
import { indexRepo } from "./tools/index_repo.js";

const server = new McpServer({ name: "starmapper", version: "0.1.0" });

const ownerRepo = {
  owner: z.string().describe("GitHub repository owner (e.g. 'vercel')"),
  repo: z.string().describe("GitHub repository name (e.g. 'next.js')"),
};

server.tool(
  "get_repo_stats",
  "Get audience statistics for a GitHub repository indexed on StarMapper. Returns total stars, geocoded count, top countries, top cities, and organic score summary.",
  ownerRepo,
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getRepoStats({ owner, repo }) }] }),
);

server.tool(
  "get_organic_score",
  "Get the organic score for a GitHub repository: a 0-100 heuristic measuring whether star growth looks natural. Returns score, verdict, and breakdown of all signals with their weights.",
  ownerRepo,
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getOrganicScore({ owner, repo }) }] }),
);

server.tool(
  "get_velocity",
  "Get per-country star velocity for a GitHub repository: rising, new, stable, or declining over the last 30 days vs the 31-90 day window.",
  ownerRepo,
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getVelocity({ owner, repo }) }] }),
);

server.tool(
  "get_influential_stargazers",
  "List stargazers of a GitHub repository above a follower threshold. Useful for finding VIP users to engage with for a product launch or announcement.",
  {
    ...ownerRepo,
    min_followers: z.number().int().min(0).optional().describe("Minimum follower count. Use 500, 1000, or 5000. Defaults to 500."),
  },
  async ({ owner, repo, min_followers }) => ({
    content: [{ type: "text" as const, text: await getInfluentialStargazers({ owner, repo, min_followers }) }],
  }),
);

server.tool(
  "index_repo",
  "Trigger full indexation of a GitHub repository on StarMapper. Fetches all stargazers, geocodes their locations, and saves the result. For large repos (10k+ stars) this may take several minutes.",
  ownerRepo,
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await indexRepo({ owner, repo }) }] }),
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
