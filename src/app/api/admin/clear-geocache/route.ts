// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError } from "@/lib/api-helpers";

export const POST = async (req: NextRequest) => {
  // Destructive operation — local dev only. Blocked in production.
  // Run via script instead: DATABASE_URL=<prod_url> npx tsx scripts/clean-geocache-garbage.ts
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });

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
