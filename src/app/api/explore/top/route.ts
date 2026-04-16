// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type TopUser = {
  login: string;
  name: string | null;
  followers: number;
  company: string | null;
  avatarUrl: string;
  publicRepos: number;
  lat: number | null;
  lng: number | null;
  countryNormalized: string | null;
};

export type TopUsersResponse = {
  items: TopUser[];
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
    ...(country ? { countryNormalized: { equals: country, mode: "insensitive" as const } } : {}),
    ...(search  ? {
      OR: [
        { login: { contains: search, mode: "insensitive" as const } },
        { name:  { contains: search, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  type RawUser = { login: string; name: string | null; followers: number; company: string | null; publicRepos: number; lat: number | null; lng: number | null; countryNormalized: string | null };

  try {
    const [users, total] = await Promise.all([
      // UNION splits the OR across two GIN trigram indexes (login + name), each branch
      // gets its own index scan. A single WHERE login ILIKE x OR name ILIKE x causes
      // the planner to prefer a parallel seq scan over BitmapOr of two GIN indexes.
      search && !country
        ? prisma.$queryRaw<RawUser[]>`
            SELECT * FROM (
              SELECT login, name, followers, company, "publicRepos", lat, lng, "countryNormalized" FROM github_user WHERE login ILIKE ${`%${search}%`}
              UNION
              SELECT login, name, followers, company, "publicRepos", lat, lng, "countryNormalized" FROM github_user WHERE name  ILIKE ${`%${search}%`}
            ) sub
            ORDER BY followers DESC LIMIT ${size} OFFSET ${skip}
          `
        : search && country
        ? prisma.$queryRaw<RawUser[]>`
            SELECT * FROM (
              SELECT login, name, followers, company, "publicRepos", lat, lng, "countryNormalized" FROM github_user WHERE login ILIKE ${`%${search}%`} AND "countryNormalized" ILIKE ${country}
              UNION
              SELECT login, name, followers, company, "publicRepos", lat, lng, "countryNormalized" FROM github_user WHERE name  ILIKE ${`%${search}%`} AND "countryNormalized" ILIKE ${country}
            ) sub
            ORDER BY followers DESC LIMIT ${size} OFFSET ${skip}
          `
        : prisma.gitHubUser.findMany({
            where,
            orderBy: { followers: "desc" },
            skip,
            take: size,
            select: { login: true, name: true, followers: true, company: true, publicRepos: true, lat: true, lng: true, countryNormalized: true },
          }),
      // Avoid full table COUNT on unfiltered requests — use pg_class estimate (microseconds vs 2s).
      // country-only filter: country_stats_mv has the pre-aggregated count (<5ms vs 7s full scan).
      isFiltered && country && !search
        ? prisma.$queryRaw<{ cnt: bigint }[]>`
            SELECT cnt FROM country_stats_mv WHERE LOWER(country) = LOWER(${country})
          `.then((rows) => Number(rows[0]?.cnt ?? 0))
        : isFiltered
        ? prisma.gitHubUser.count({ where })
        : prisma.$queryRaw<{ n: bigint }[]>`
            SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'github_user'
          `.then((rows) => Number(rows[0]?.n ?? 0)),
    ]);

    const items: TopUser[] = users.map((u) => ({
      ...u,
      lat: u.lat ?? null,
      lng: u.lng ?? null,
      countryNormalized: u.countryNormalized ?? null,
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
