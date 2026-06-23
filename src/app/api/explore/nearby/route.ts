// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type NearbyUser = {
  login: string;
  name: string | null;
  followers: number;
  company: string | null;
  cityNormalized: string | null;
  countryNormalized: string | null;
  trackedRepos: number;
  // lat/lng rounded to 1 decimal (~11km) — city-level precision only, not individual
  lat: number;
  lng: number;
  distanceKm: number;
};

export type NearbyCity = {
  city: string;
  count: number;
  // city-level centroid (rounded to 1 decimal ~11km — safe for aggregate display)
  lat: number;
  lng: number;
};

export type NearbyResponse = {
  users: NearbyUser[];
  total: number;
  page: number;
  pageSize: number;
  cities: NearbyCity[];
};

const MIN_RADIUS_KM = 25;
const MAX_RADIUS_KM = 200;
const MAX_PAGE = 10;
const PAGE_SIZE = 30;
const MAX_RESULTS = 300; // hard cap across all pages

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);

  const lat    = parseFloat(searchParams.get("lat")    ?? "");
  const lng    = parseFloat(searchParams.get("lng")    ?? "");
  const radius = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM,
    parseFloat(searchParams.get("radius") ?? "50"),
  ));
  const page   = Math.min(MAX_PAGE, Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)));

  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return jsonError("invalid_coords", 400);
  }

  // Bounding box (bounding box → index on [lat, lng] eliminates ~99% of rows before Haversine)
  const latDelta = radius / 111.0;
  const lngDelta = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;

  const skip = (page - 1) * PAGE_SIZE;
  if (skip >= MAX_RESULTS) return jsonError("invalid_params", 400);

  try {
    // Two queries run in parallel — they scan the same bounding box independently
    // but are otherwise unrelated (users vs city aggregates).
    //
    // Main query — four-stage CTE to avoid O(N) JOIN on dense bounding boxes.
    // Fix: compute Haversine once (MATERIALIZED), cap at MAX_RESULTS, then JOIN only
    // on the final PAGE_SIZE rows. Reduces MV lookups from 12k → 30.
    type UserRow = {
      login: string;
      name: string | null;
      followers: number;
      company: string | null;
      city_normalized: string | null;
      country_normalized: string | null;
      tracked_repos: bigint;
      total_count: bigint;
      ulat: number;
      ulng: number;
      distance_km: number;
    };
    type CityRow = { city: string; cnt: bigint; clat: number; clng: number };

    const [rows, cityRows] = await Promise.all([
      prisma.$queryRaw<UserRow[]>`
        WITH bbox AS MATERIALIZED (
          SELECT
            u.login,
            u.name,
            u.followers,
            u.company,
            u."cityNormalized"                          AS city_normalized,
            u."countryNormalized"                       AS country_normalized,
            ROUND(u.lat::numeric, 1)::float             AS ulat,
            ROUND(u.lng::numeric, 1)::float             AS ulng,
            ROUND(
              (6371 * acos(
                LEAST(1.0, cos(radians(${lat})) * cos(radians(u.lat))
                * cos(radians(u.lng) - radians(${lng}))
                + sin(radians(${lat})) * sin(radians(u.lat)))
              ))::numeric, 1
            )::float                                    AS distance_km
          FROM github_user u
          WHERE
            u.lat BETWEEN ${minLat} AND ${maxLat}
            AND u.lng BETWEEN ${minLng} AND ${maxLng}
            AND u.lat IS NOT NULL
            AND u.lng IS NOT NULL
        ),
        nearby AS MATERIALIZED (
          SELECT * FROM bbox
          WHERE distance_km <= ${radius}
          ORDER BY followers DESC
          LIMIT ${MAX_RESULTS}
        ),
        page_rows AS (
          SELECT n.*, COALESCE(rc.repo_count, 0) AS tracked_repos
          FROM (SELECT * FROM nearby LIMIT ${PAGE_SIZE} OFFSET ${skip}) n
          LEFT JOIN user_repo_count_mv rc ON rc.login = n.login
        ),
        total AS (SELECT COUNT(*)::bigint AS total_count FROM nearby)
        SELECT p.*, t.total_count FROM page_rows p CROSS JOIN total t
      `,
      // City aggregates — read pre-computed centroids from city_stats_mv instead of
      // a live GROUP BY + Haversine over millions of github_user rows. The MV holds one
      // row per (city, 1° bucket); we bbox-prefilter on its (lat, lng) index, then keep
      // cities whose centroid is within the radius. cnt is the global city size.
      prisma.$queryRaw<CityRow[]>`
        SELECT
          city,
          cnt,
          lat AS clat,
          lng AS clng
        FROM city_stats_mv
        WHERE
          lat BETWEEN ${minLat} AND ${maxLat}
          AND lng BETWEEN ${minLng} AND ${maxLng}
          AND (
            6371 * acos(
              LEAST(1.0, cos(radians(${lat})) * cos(radians(lat))
              * cos(radians(lng) - radians(${lng}))
              + sin(radians(${lat})) * sin(radians(lat)))
            )
          ) <= ${radius}
        ORDER BY cnt DESC
        LIMIT 50
      `,
    ]);

    const total = rows.length > 0 ? Math.min(Number(rows[0].total_count), MAX_RESULTS) : 0;

    const users: NearbyUser[] = rows.map((r) => ({
      login: r.login,
      name: r.name,
      followers: r.followers,
      company: r.company,
      cityNormalized: r.city_normalized,
      countryNormalized: r.country_normalized,
      trackedRepos: Number(r.tracked_repos),
      lat: r.ulat,
      lng: r.ulng,
      distanceKm: r.distance_km,
    }));

    const cities: NearbyCity[] = cityRows.map((r) => ({
      city: r.city,
      count: Number(r.cnt),
      lat: r.clat,
      lng: r.clng,
    }));

    return NextResponse.json(
      { users, total, page, pageSize: PAGE_SIZE, cities } satisfies NearbyResponse,
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("42P01")) {
      return NextResponse.json(
        { users: [], total: 0, page, pageSize: PAGE_SIZE, cities: [] } satisfies NearbyResponse,
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    logError("explore/nearby", err);
    return jsonError("internal", 500);
  }
};