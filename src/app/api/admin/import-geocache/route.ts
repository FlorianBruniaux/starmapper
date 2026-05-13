// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError } from "@/lib/api-helpers";
import { defineRoute } from "@/lib/define-route";
import { adminImportGeocacheSchema } from "@/schemas/admin-import-geocache";

export const POST = async (req: NextRequest) => {
  // Destructive operation — local dev only. Blocked in production.
  // Run via script instead: DATABASE_URL=<prod_url> pnpm seed:geonames
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const authError = requireAdminAuth(req);
  if (authError) return authError;

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 5 * 1024 * 1024) return jsonError("payload_too_large", 413);

  return defineRoute(adminImportGeocacheSchema, async (_req, entries) => {
    const rows = Object.entries(entries).map(([key, val]) => ({
      key,
      lat: val ? val[0] : null,
      lng: val ? val[1] : null,
    }));

    let inserted = 0;
    let skipped = 0;

    // Batch upsert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      for (const row of batch) {
        try {
          await prisma.geoCache.upsert({
            where: { key: row.key },
            update: { lat: row.lat, lng: row.lng },
            create: { key: row.key, lat: row.lat, lng: row.lng },
          });
          inserted++;
        } catch {
          skipped++;
        }
      }
    }

    const total = await prisma.geoCache.count();
    return NextResponse.json({ inserted, skipped, total });
  })(req);
}
