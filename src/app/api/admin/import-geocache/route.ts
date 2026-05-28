// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
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

    let upserted = 0;

    // Bulk upsert via UNNEST: 1 round-trip per batch of 500 instead of N individual upserts.
    // Same pattern as bulkUpsertUsers in user-cache.ts.
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const keys = batch.map((r) => r.key);
      const lats = batch.map((r) => r.lat);
      const lngs = batch.map((r) => r.lng);
      try {
        await prisma.$queryRaw`
          INSERT INTO geocache (key, lat, lng)
          SELECT
            unnest(${keys}::text[]),
            unnest(${lats}::float8[]),
            unnest(${lngs}::float8[])
          ON CONFLICT (key) DO UPDATE
            SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
        `;
        upserted += batch.length;
      } catch {
        // Batch skipped — continue with remaining batches
      }
    }

    const total = await prisma.geoCache.count();
    return NextResponse.json({ upserted, total });
  })(req);
}
