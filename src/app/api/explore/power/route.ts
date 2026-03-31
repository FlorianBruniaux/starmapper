// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type PowerResponse = {
  items: { login: string; name: string | null; followers: number; trackedRepos: number; avatarUrl: string }[];
  total: number;
  page: number;
  pageSize: number;
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page = Math.min(20, Math.max(1, parseInt(searchParams.get("page") ?? "1",  10)));
  const size = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const skip = (page - 1) * size;

  try {
    const [groups, countRows] = await Promise.all([
      prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
        SELECT login, COUNT(*) AS cnt
        FROM star_event
        GROUP BY login
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT ${size}::int OFFSET ${skip}::int
      `,
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total
        FROM (SELECT 1 FROM star_event GROUP BY login HAVING COUNT(*) > 1) subq
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);

    const logins = groups.map((g) => g.login);
    const users = logins.length > 0
      ? await prisma.gitHubUser.findMany({
          where: { login: { in: logins } },
          select: { login: true, name: true, followers: true },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.login, u]));
    const items = groups.map((g) => {
      const u = userMap.get(g.login);
      return {
        login: g.login,
        name: u?.name ?? null,
        followers: u?.followers ?? 0,
        trackedRepos: Number(g.cnt),
        avatarUrl: `https://github.com/${g.login}.png`,
      };
    });

    return NextResponse.json(
      { items, total, page, pageSize: size } satisfies PowerResponse,
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    logError("explore/power", err);
    return jsonError("internal", 500);
  }
};
