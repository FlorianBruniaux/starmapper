// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError } from "@/lib/api-helpers";

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  try {
    const deleted = await prisma.geoCache.deleteMany({ where: { lat: null } });
    const remaining = await prisma.geoCache.count();
    return NextResponse.json({ deleted: deleted.count, remaining });
  } catch {
    return jsonError("internal", 500);
  }
}
