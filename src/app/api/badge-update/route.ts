// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, mappedCount, countryCount, totalCount } = body;

    const repoNameRe = /^[a-zA-Z0-9._-]{1,100}$/;
    if (
      typeof owner !== "string" || !repoNameRe.test(owner) ||
      typeof repo !== "string" || !repoNameRe.test(repo) ||
      typeof mappedCount !== "number" || mappedCount < 0 || mappedCount > 10_000_000 ||
      typeof countryCount !== "number" || countryCount < 0 || countryCount > 10_000 ||
      typeof totalCount !== "number" || totalCount < 0 || totalCount > 10_000_000
    ) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    await prisma.badgeCache.upsert({
      where: { owner_repo: { owner: owner.toLowerCase(), repo: repo.toLowerCase() } },
      create: {
        owner: owner.toLowerCase(),
        repo: repo.toLowerCase(),
        mappedCount,
        countryCount,
        totalCount,
      },
      update: { mappedCount, countryCount, totalCount },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
