// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/dependencies/[owner]/[repo]
// MCP-optimised endpoint: returns the dependencies declared by a GitHub repository,
// fetched live via GitHub's Dependency Graph SBOM API.
// Returns disabled:true when the dependency graph is not enabled for the repo.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError, extractGhToken } from "@/lib/api-helpers";
import {
  fetchRepoDependencies,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";

const TOP_N = 100;

export type McpDependenciesResponse = {
  dependencies: Array<{
    name: string;
    ecosystem: string | null;
    version: string | null;
  }>;
  totalCount: number;
  shownCount: number;
  truncated: boolean;
  disabled: boolean;
  fetchedAt: string;
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  const key = validateOwnerRepo(rawOwner, rawRepo);
  if (!key) return jsonError("invalid_params", 400);

  const clientToken = extractGhToken(req);

  try {
    const result = await fetchRepoDependencies(key.owner, key.repo, clientToken);

    if (result.disabled) {
      const response: McpDependenciesResponse = {
        dependencies: [],
        totalCount: 0,
        shownCount: 0,
        truncated: false,
        disabled: true,
        fetchedAt: new Date().toISOString(),
      };
      return NextResponse.json(response, {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
      });
    }

    const top = result.dependencies.slice(0, TOP_N);

    const response: McpDependenciesResponse = {
      dependencies: top,
      totalCount: result.totalCount,
      shownCount: top.length,
      truncated: result.totalCount > TOP_N,
      disabled: false,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    if (err instanceof GitHubTokenInvalidError) return jsonError("token_invalid", 401);
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: "rate_limited", resetAt: err.resetAt },
        { status: 429 },
      );
    }
    logError("api/mcp/dependencies GET", err);
    return jsonError("internal", 500);
  }
};
