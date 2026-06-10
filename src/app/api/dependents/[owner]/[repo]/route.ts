// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/dependents/[owner]/[repo]
// Cache-first read: returns dependents from dependents_cache if fresh.
// Returns 404 if cache miss (client should trigger POST .../refresh).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";
import { sortDependents } from "@/lib/dependents";
import type { DependentsResult, DependentRow, ResolvedPackage, SortBy } from "@/lib/dependents";

export type DependentsApiResponse = {
  packages: ResolvedPackage[];
  dependents: DependentRow[];
  totalCount: number;
  page: number;
  perPage: number;
  totalPages: number;
  sortedBy: SortBy;
  truncated: boolean;
  fetchedAt: string;
};

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  if (!OWNER_REPO_RE.test(rawOwner) || !OWNER_REPO_RE.test(rawRepo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(rawOwner, rawRepo);

  const sp = req.nextUrl.searchParams;
  const sortRaw = sp.get("sort") ?? "stars";
  const sortBy: SortBy = sortRaw === "forks" ? "forks" : sortRaw === "name" ? "name" : "stars";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(sp.get("per_page") ?? String(DEFAULT_PER_PAGE), 10)));

  try {
    const row = await prisma.dependentsCache.findUnique({
      where: { owner_repo: key },
      select: { dataGz: true, totalCount: true, fetchedAt: true, expiresAt: true },
    });

    if (!row) return jsonError("not_found", 404);

    const now = new Date();
    if (row.expiresAt < now) return jsonError("not_found", 404);

    let result: DependentsResult;
    try {
      result = decompressGzBase64<DependentsResult>(row.dataGz)[0]!;
    } catch (err) {
      logError("api/dependents GET decompress", err);
      return jsonError("cache_corrupt", 500);
    }

    const sorted = sortDependents(result.dependents, sortBy);
    const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
    const start = (page - 1) * perPage;
    const pageRows = sorted.slice(start, start + perPage);

    const response: DependentsApiResponse = {
      packages: result.packages,
      dependents: pageRows,
      totalCount: result.totalCount,
      page,
      perPage,
      totalPages,
      sortedBy: sortBy,
      truncated: result.truncated,
      fetchedAt: result.fetchedAt,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/dependents GET", err);
    return jsonError("internal", 500);
  }
};
