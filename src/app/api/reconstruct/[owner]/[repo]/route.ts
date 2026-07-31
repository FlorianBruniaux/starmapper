// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

type Row = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  lat: number | null;
  lng: number | null;
  starredAt: Date;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT u.login, u.name, u.company, u.location, u.followers, u.lat, u.lng, se."starredAt"
      FROM star_event se
      JOIN github_user u ON u.login = se.login
      WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
      ORDER BY se."starredAt" DESC
    `;
    if (rows.length === 0) return jsonError("not_found", 404);

    const points = rows
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        login: r.login,
        name: r.name,
        bio: null,
        company: r.company,
        location: r.location,
        followers: r.followers,
        avatarUrl: `https://github.com/${r.login}.png`,
        lat: Math.round((r.lat as number) * 100) / 100,
        lng: Math.round((r.lng as number) * 100) / 100,
        starredAt: r.starredAt.toISOString(),
        linkedinUrl: null,
      }));
    const unmapped = rows
      .filter((r) => r.lat === null || r.lng === null)
      .map((r) => ({ login: r.login }));

    return NextResponse.json(
      { points, unmapped, totalCount: rows.length },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    logError("reconstruct GET", err);
    return jsonError("internal", 500);
  }
};
