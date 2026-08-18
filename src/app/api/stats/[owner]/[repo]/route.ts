// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { computeRepoStats } from "@/lib/repo-stats-query";
import { jsonError, logError } from "@/lib/api-helpers";

// Re-exported so existing consumers ([owner]/[repo]/page.tsx, page.client.tsx and the
// map components) keep importing these from here. Same pattern as MappedRepo in
// api/repos/route.ts.
export type { RepoOrganic, RepoStats } from "@/lib/repo-stats-query";

export const maxDuration = 30;

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  try {
    const result = await computeRepoStats(owner, repo);
    if (!result.ok) return jsonError(result.error, result.status);
    return NextResponse.json(result.stats, {
      headers: { "Cache-Control": result.cacheControl },
    });
  } catch (err) {
    logError("stats", err);
    return jsonError("internal", 500);
  }
};
