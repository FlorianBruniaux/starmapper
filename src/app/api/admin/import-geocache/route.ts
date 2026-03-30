// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const entries = await req.json() as Record<string, [number, number] | null>;
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
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
