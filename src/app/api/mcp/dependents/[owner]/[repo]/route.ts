// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/dependents/[owner]/[repo]
// MCP-optimised endpoint: returns top dependents sorted by stars.
// Reads DependentsCache (cache-first, no external call). Returns 404 when
// no cache entry exists — MCP clients should call /refresh first.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";
import { sortDependents } from "@/lib/dependents";
import type { DependentsResult } from "@/lib/dependents";

const MCP_TOP_N = 50;

export type McpDependentsResponse = {
  packages: Array<{ name: string; ecosystem: string; dependentReposCount: number }>;
  topDependents: Array<{
    fullName: string;
    stars: number;
    forks: number;
    language: string | null;
    ecosystem: string;
    packageName: string;
    htmlUrl: string;
  }>;
  totalCount: number;
  shownCount: number;
  truncated: boolean;
  fetchedAt: string;
  mapUrl: string;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  const key = validateOwnerRepo(rawOwner, rawRepo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const row = await prisma.dependentsCache.findUnique({
      where: { owner_repo: key },
      select: { dataGz: true, totalCount: true, fetchedAt: true, expiresAt: true },
    });

    if (!row) return jsonError("not_cached", 404);
    if (row.expiresAt < new Date()) return jsonError("cache_expired", 404);

    const [result] = decompressGzBase64<DependentsResult>(row.dataGz);
    if (!result) return jsonError("cache_corrupt", 500);

    const sorted = sortDependents(result.dependents, "stars");
    const top = sorted.slice(0, MCP_TOP_N);

    const response: McpDependentsResponse = {
      packages: result.packages.map((p) => ({
        name: p.name,
        ecosystem: p.ecosystem,
        dependentReposCount: p.dependentReposCount,
      })),
      topDependents: top.map((d) => ({
        fullName: d.fullName,
        stars: d.stars,
        forks: d.forks,
        language: d.language,
        ecosystem: d.ecosystem,
        packageName: d.packageName,
        htmlUrl: d.htmlUrl,
      })),
      totalCount: row.totalCount,
      shownCount: top.length,
      truncated: sorted.length > MCP_TOP_N,
      fetchedAt: row.fetchedAt.toISOString(),
      mapUrl: `https://starmapper.bruniaux.com/${key.owner}/${key.repo}/dependents`,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/mcp/dependents GET", err);
    return jsonError("internal", 500);
  }
};
