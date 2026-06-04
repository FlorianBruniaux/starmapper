// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// StarMapper MCP server - stdio transport, exposes 5 tools.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GET_REPO_STATS_SCHEMA, getRepoStats } from "./tools/get_repo_stats.js";
import { GET_ORGANIC_SCORE_SCHEMA, getOrganicScore } from "./tools/get_organic_score.js";
import { GET_VELOCITY_SCHEMA, getVelocity } from "./tools/get_velocity.js";
import { GET_INFLUENTIAL_SCHEMA, getInfluentialStargazers } from "./tools/get_influential_stargazers.js";
import { INDEX_REPO_SCHEMA, indexRepo } from "./tools/index_repo.js";

const server = new Server(
  { name: "starmapper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  GET_REPO_STATS_SCHEMA,
  GET_ORGANIC_SCORE_SCHEMA,
  GET_VELOCITY_SCHEMA,
  GET_INFLUENTIAL_SCHEMA,
  INDEX_REPO_SCHEMA,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let text: string;

    if (name === "get_repo_stats") {
      text = await getRepoStats(args as { owner: string; repo: string });
    } else if (name === "get_organic_score") {
      text = await getOrganicScore(args as { owner: string; repo: string });
    } else if (name === "get_velocity") {
      text = await getVelocity(args as { owner: string; repo: string });
    } else if (name === "get_influential_stargazers") {
      text = await getInfluentialStargazers(
        args as { owner: string; repo: string; min_followers?: number }
      );
    } else if (name === "index_repo") {
      text = await indexRepo(args as { owner: string; repo: string });
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
