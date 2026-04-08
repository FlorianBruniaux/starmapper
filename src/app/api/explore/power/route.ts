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
  nextCursor: string | null;
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page = Math.min(20, Math.max(1, parseInt(searchParams.get("page") ?? "1",  10)));
  const size = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const cursor = searchParams.get("cursor"); // keyset cursor: "${cnt}|${login}"

  // Hard offset cap (OFFSET-based) — prevents full scan on deep pages
  const MAX_SKIP = 500;
  const skip = (page - 1) * size;
  if (!cursor && skip > MAX_SKIP) return jsonError("invalid_params", 400);

  try {
    // power_users_mv pre-aggregates star_event (11.9M rows) — reads in ~5ms instead of timeout.
    // Keyset pagination when cursor provided — O(1) regardless of page depth.
    // Fallback to OFFSET when no cursor (first page or legacy page param).
    let groupsQuery: Promise<{ login: string; cnt: bigint }[]>;
    if (cursor) {
      const [cntStr, cursorLogin] = cursor.split("|");
      const cursorCnt = parseInt(cntStr, 10);
      if (!cursorLogin || isNaN(cursorCnt)) return jsonError("invalid_params", 400);
      groupsQuery = prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
        SELECT login, cnt FROM power_users_mv
        WHERE cnt < ${cursorCnt}::bigint
           OR (cnt = ${cursorCnt}::bigint AND login > ${cursorLogin})
        ORDER BY cnt DESC, login ASC
        LIMIT ${size}::int
      `;
    } else {
      groupsQuery = prisma.$queryRaw<{ login: string; cnt: bigint }[]>`
        SELECT login, cnt FROM power_users_mv
        ORDER BY cnt DESC, login ASC
        LIMIT ${size}::int OFFSET ${skip}::int
      `;
    }

    const [groups, totalRows] = await Promise.all([
      groupsQuery,
      prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM power_users_mv`,
    ]);
    const total = Number(totalRows[0]?.total ?? 0);

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

    const lastGroup = groups[groups.length - 1];
    const nextCursor = groups.length === size && lastGroup
      ? `${Number(lastGroup.cnt)}|${lastGroup.login}`
      : null;

    return NextResponse.json(
      { items, total, page, pageSize: size, nextCursor } satisfies PowerResponse,
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    logError("explore/power", err);
    return jsonError("internal", 500);
  }
};
