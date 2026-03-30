// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type ProfileResponse = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  publicRepos: number;
  ownedRepos: { owner: string; repo: string }[];
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(login)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  try {
    const [user, ownedReposRaw] = await Promise.all([
      prisma.gitHubUser.findUnique({
        where: { login },
        select: { login: true, name: true, company: true, location: true, followers: true, publicRepos: true },
      }),
      prisma.badgeCache.findMany({
        where: { owner: login.toLowerCase() },
        select: { owner: true, repo: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const profile: ProfileResponse = {
      ...user,
      ownedRepos: ownedReposRaw.map((r) => ({ owner: r.owner, repo: r.repo })),
    };

    return NextResponse.json(profile, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[profile] Error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
