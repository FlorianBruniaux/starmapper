#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper MCP server - stdio transport, exposes 10 tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getRepoStats } from "./tools/get_repo_stats.js";
import { getOrganicScore } from "./tools/get_organic_score.js";
import { getVelocity } from "./tools/get_velocity.js";
import { getInfluentialStargazers } from "./tools/get_influential_stargazers.js";
import { indexRepo } from "./tools/index_repo.js";
import { getCacheStatus } from "./tools/get_cache_status.js";
import { getTrending } from "./tools/get_trending.js";
import { listRepos } from "./tools/list_repos.js";
import { healthCheck } from "./tools/health_check.js";
import { getDependents } from "./tools/get_dependents.js";

const server = new McpServer({ name: "starmapper", version: "0.1.0" });

const ownerRepo = {
  owner: z.string().describe("GitHub repository owner (e.g. 'vercel')"),
  repo: z.string().describe("GitHub repository name (e.g. 'next.js')"),
};

server.registerTool(
  "get_repo_stats",
  {
    description: "Get audience statistics for a GitHub repository indexed on StarMapper. Returns total stars, geocoded count, top countries, top cities, and organic score summary.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getRepoStats({ owner, repo }) }] }),
);

server.registerTool(
  "get_organic_score",
  {
    description: "Get the organic score for a GitHub repository: a 0-100 heuristic measuring whether star growth looks natural. Returns score, verdict, and breakdown of all signals with their weights.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getOrganicScore({ owner, repo }) }] }),
);

server.registerTool(
  "get_velocity",
  {
    description: "Get per-country star velocity for a GitHub repository: rising, new, stable, or declining over the last 30 days vs the 31-90 day window.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await getVelocity({ owner, repo }) }] }),
);

server.registerTool(
  "get_influential_stargazers",
  {
    description: "List stargazers of a GitHub repository above a follower threshold. Useful for finding VIP users to engage with for a product launch or announcement.",
    inputSchema: {
      ...ownerRepo,
      min_followers: z.number().int().min(0).optional().describe("Minimum follower count. Use 500, 1000, or 5000. Defaults to 500."),
    },
  },
  async ({ owner, repo, min_followers }) => ({
    content: [{ type: "text" as const, text: await getInfluentialStargazers({ owner, repo, min_followers }) }],
  }),
);

server.registerTool(
  "index_repo",
  {
    description: "Trigger full indexation of a GitHub repository on StarMapper. Fetches all stargazers, geocodes their locations, and saves the result. For large repos (10k+ stars) this may take several minutes.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({ content: [{ type: "text" as const, text: await indexRepo({ owner, repo }) }] }),
);

server.registerTool(
  "health_check",
  {
    description: "Check that the StarMapper MCP server is correctly configured. Verifies API reachability, GITHUB_TOKEN presence, and active endpoint. Call this first to confirm your setup is working.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text" as const, text: await healthCheck() }] }),
);

server.registerTool(
  "get_cache_status",
  {
    description: "Check whether a GitHub repository is already indexed on StarMapper. Returns last scan date, total star count, and geocoded count. Use before index_repo to avoid redundant re-scans.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({
    content: [{ type: "text" as const, text: await getCacheStatus({ owner, repo }) }],
  }),
);

server.registerTool(
  "get_trending",
  {
    description: "List the GitHub repositories currently trending on StarMapper, ranked by star velocity over the last 7 days. Returns up to 20 repos with 7-day and 30-day star counts and programming language.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text" as const, text: await getTrending() }] }),
);

server.registerTool(
  "list_repos",
  {
    description: "List GitHub repositories already indexed on StarMapper with their geocoded star counts and mapping rates. Useful to discover what data is available before calling other tools.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Maximum number of repos to return (default 50, max 200)."),
    },
  },
  async ({ limit }) => ({
    content: [{ type: "text" as const, text: await listRepos({ limit }) }],
  }),
);

server.registerTool(
  "get_dependents",
  {
    description: "List the open-source repos that depend on a given GitHub library, sorted by stars. Useful for discovering who uses a library and how prominent those users are. Returns top 50 dependent repos with star/fork counts, language, and ecosystem. Data is sourced from ecosyste.ms and cached for 7 days.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({
    content: [{ type: "text" as const, text: await getDependents({ owner, repo }) }],
  }),
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
