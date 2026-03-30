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
  updatedAt: string;
};

export const GET = async () => {
  try {
    const rows = await prisma.badgeCache.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    const repos: MappedRepo[] = rows.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      mappedCount: r.mappedCount,
      countryCount: r.countryCount,
      totalCount: r.totalCount,
      mappedPercent: r.totalCount > 0 ? Math.round((r.mappedCount / r.totalCount) * 100) : 0,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ repos });
  } catch {
    return jsonError("internal", 500);
  }
};