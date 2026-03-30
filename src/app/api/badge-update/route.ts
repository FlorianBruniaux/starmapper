// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError } from "@/lib/api-helpers";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, mappedCount, countryCount, totalCount } = body;

    const key = validateOwnerRepo(owner, repo);
    if (
      !key ||
      typeof mappedCount !== "number" || mappedCount < 0 || mappedCount > 10_000_000 ||
      typeof countryCount !== "number" || countryCount < 0 || countryCount > 10_000 ||
      typeof totalCount !== "number" || totalCount < 0 || totalCount > 10_000_000
    ) {
      return jsonError("invalid_params", 400);
    }

    await prisma.badgeCache.upsert({
      where: { owner_repo: key },
      create: { ...key, mappedCount, countryCount, totalCount },
      update: { mappedCount, countryCount, totalCount },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("internal", 500);
  }
};
