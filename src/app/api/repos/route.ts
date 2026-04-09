// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";

export type MappedRepo = {
  owner: string;
  repo: string;
  mappedCount: number;
  countryCount: number;
  totalCount: number;
  mappedPercent: number;
  language: string | null;
  updatedAt: string;
};

export type ReposResponse = {
  repos: MappedRepo[];
  total: number;
};

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 10000) : 10000;

    const [rows, total] = await Promise.all([
      prisma.badgeCache.findMany({ orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.badgeCache.count(),
    ]);

    const repos: MappedRepo[] = rows.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      mappedCount: r.mappedCount,
      countryCount: r.countryCount,
      totalCount: r.totalCount,
      mappedPercent: r.totalCount > 0 ? Math.round((r.mappedCount / r.totalCount) * 100) : 0,
      language: r.language ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ repos, total } satisfies ReposResponse, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return jsonError("internal", 500);
  }
};