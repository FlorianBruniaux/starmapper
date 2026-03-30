// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";

export type TopUsersResponse = {
  items: { login: string; name: string | null; followers: number; company: string | null; avatarUrl: string; publicRepos: number }[];
  total: number;
  page: number;
  pageSize: number;
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
  const size    = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const country = searchParams.get("country") ?? "";
  const search  = searchParams.get("search")  ?? "";

  const isFiltered = Boolean(country || search);
  const skip = (page - 1) * size;

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
      prisma.gitHubUser.count({ where }),
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
    console.error("[explore/top] Error:", err);
    return jsonError("internal", 500);
  }
};
