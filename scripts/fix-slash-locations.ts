// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * fix-slash-locations.ts
 *
 * Fixes bad geocoding for multi-city abbreviation strings like "DEL/BLR/SF", "NJ/NYC", "SF/NY".
 * These were previously sent as-is to geocoding providers and returned wrong results.
 *
 * The geocoder now splits "/" strings and tries each part individually.
 * This script clears the bad cached results so next scan re-geocodes correctly.
 *
 * Usage:
 *   pnpm exec tsx scripts/fix-slash-locations.ts --dry-run   # preview
 *   pnpm exec tsx scripts/fix-slash-locations.ts             # apply
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

const { values: argv } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
  strict: true,
});
const DRY_RUN = argv["dry-run"];

const main = async () => {
  console.log(`\n=== Fix Slash Locations ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}\n`);

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Find affected github_user entries (raw SQL for regex performance on large table)
    const affected = await prisma.$queryRaw<{ login: string; location: string }[]>`
      SELECT login, location FROM github_user
      WHERE lat IS NOT NULL
      AND location ~ '^[A-Z0-9]{2,6}(\\/[A-Z0-9]{2,6}){1,5}$'
    `;

    console.log(`github_user entries with bad slash-geocoding: ${affected.length}`);
    const sample = affected.slice(0, 15);
    for (const u of sample) console.log(`  ${u.login.padEnd(20)} "${u.location}"`);
    if (affected.length > 15) console.log(`  ... and ${affected.length - 15} more`);

    // 2. Find corresponding geocache entries to delete
    const locationKeys = [...new Set(affected.map((u) => u.location.toLowerCase().trim()))];
    const cachedEntries = await prisma.geoCache.findMany({
      where: { key: { in: locationKeys } },
      select: { key: true, lat: true, lng: true },
    });

    console.log(`\nGeoCache entries to delete: ${cachedEntries.length}`);
    for (const c of cachedEntries.slice(0, 10)) {
      console.log(`  "${c.key}" → ${c.lat?.toFixed(4)}, ${c.lng?.toFixed(4)}`);
    }

    if (affected.length === 0 && cachedEntries.length === 0) {
      console.log("\nNothing to fix.");
      return;
    }

    if (DRY_RUN) {
      console.log(`\nDry-run: would null lat/lng for ${affected.length} users, delete ${cachedEntries.length} geocache entries.`);
      return;
    }

    // 3. Null out lat/lng in github_user
    const logins = affected.map((u) => u.login);
    const updatedUsers = await prisma.$executeRaw`
      UPDATE github_user SET lat = NULL, lng = NULL
      WHERE login = ANY(${logins}::text[])
    `;

    // 4. Delete bad geocache entries
    const deletedCache = await prisma.geoCache.deleteMany({
      where: { key: { in: locationKeys } },
    });

    console.log(`\n=== Done ===`);
    console.log(`  Users fixed (lat/lng nulled): ${updatedUsers}`);
    console.log(`  Geocache entries deleted: ${deletedCache.count}`);
    console.log(`\nThese users will be re-geocoded correctly on next scan.`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});