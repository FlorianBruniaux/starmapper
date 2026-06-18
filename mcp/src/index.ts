#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper MCP server - stdio transport, exposes 15 tools.

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
import { getContributors } from "./tools/get_contributors.js";
import { getFollowers } from "./tools/get_followers.js";
import { getCountryStats } from "./tools/get_country_stats.js";
import { getGlobalCountryStats } from "./tools/get_global_country_stats.js";
import { getDependencies } from "./tools/get_dependencies.js";

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

server.registerTool(
  "get_contributors",
  {
    description: "List the top contributors of a GitHub repository with their contribution counts. Optionally enrich with each contributor's location by passing with_locations: true (adds a server-side lookup, slightly slower). Returns up to 50 contributors.",
    inputSchema: {
      ...ownerRepo,
      with_locations: z.boolean().optional().describe("If true, enrich each contributor with their location from StarMapper data. Defaults to false."),
    },
  },
  async ({ owner, repo, with_locations }) => ({
    content: [{ type: "text" as const, text: await getContributors({ owner, repo, with_locations }) }],
  }),
);

server.registerTool(
  "get_followers",
  {
    description: "List the top followers of a GitHub user by follower count. Returns up to 100 followers sorted descending by their own follower count, with name, company, and location.",
    inputSchema: {
      login: z.string().describe("GitHub username (e.g. 'gaearon')"),
    },
  },
  async ({ login }) => ({
    content: [{ type: "text" as const, text: await getFollowers({ login }) }],
  }),
);

server.registerTool(
  "get_country_stats",
  {
    description: "Get the country and city distribution of stargazers for a specific GitHub repository already indexed on StarMapper. Returns full country list and top 30 cities with counts. Use get_cache_status first to confirm the repo is indexed.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({
    content: [{ type: "text" as const, text: await getCountryStats({ owner, repo }) }],
  }),
);

server.registerTool(
  "get_global_country_stats",
  {
    description: "Get the global distribution of stargazers by country across ALL repositories indexed on StarMapper. Returns a ranked country list with geocoded developer counts. Data reflects the last materialized view refresh (typically up to date within a few hours).",
    inputSchema: {},
  },
  async () => ({
    content: [{ type: "text" as const, text: await getGlobalCountryStats() }],
  }),
);

server.registerTool(
  "get_dependencies",
  {
    description: "List the direct dependencies declared in a GitHub repository's dependency graph (its own package dependencies, not who depends on it). Returns package name, ecosystem (npm, pip, etc.), and version. Requires the GitHub dependency graph to be enabled on the repo.",
    inputSchema: ownerRepo,
  },
  async ({ owner, repo }) => ({
    content: [{ type: "text" as const, text: await getDependencies({ owner, repo }) }],
  }),
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
