// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type TopUsersResponse = {
  items: { login: string; name: string | null; followers: number; company: string | null; avatarUrl: string; publicRepos: number }[];
  total: number;
  page: number;
  pageSize: number;
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page    = Math.min(20, Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10)));
  const size    = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const country = (searchParams.get("country") ?? "").substring(0, 100).replace(/[^\p{L}\p{N}\s'.,()-]/gu, "");
  const search  = (searchParams.get("search")  ?? "").substring(0, 100).replace(/[^\p{L}\p{N}\s'.,()-]/gu, "");

  // Minimum filter length — single-char filters enumerate the whole table cross-product
  if (country && country.trim().length < 2) return jsonError("invalid_params", 400);
  if (search  && search.trim().length  < 2) return jsonError("invalid_params", 400);

  const isFiltered = Boolean(country || search);
  const skip = (page - 1) * size;

  // Hard skip cap — prevents full table enumeration even with page cycling
  const MAX_SKIP = 500;
  if (skip > MAX_SKIP) return jsonError("invalid_params", 400);

  const where = {
    ...(country ? { location: { contains: country, mode: "insensitive" as const } } : {}),
    ...(search  ? {
      OR: [
        { login: { contains: search, mode: "insensitive" as const } },
        { name:  { contains: search, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  try {
    const [users, total] = await Promise.all([
      prisma.gitHubUser.findMany({
        where,
        orderBy: { followers: "desc" },
        skip,
        take: size,
        select: { login: true, name: true, followers: true, company: true, publicRepos: true },
      }),
      // Avoid full table COUNT on unfiltered requests — use pg_class estimate (microseconds vs 2s).
      isFiltered
        ? prisma.gitHubUser.count({ where })
        : prisma.$queryRaw<{ n: bigint }[]>`
            SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'github_user'
          `.then((rows) => Number(rows[0]?.n ?? 0)),
    ]);

    const items = users.map((u) => ({
      ...u,
      avatarUrl: `https://github.com/${u.login}.png`,
    }));

    return NextResponse.json(
      { items, total, page, pageSize: size } satisfies TopUsersResponse,
      {
        headers: isFiltered
          ? { "Cache-Control": "no-store" }
          : { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      },
    );
  } catch (err) {
    logError("explore/top", err);
    return jsonError("internal", 500);
  }
};
