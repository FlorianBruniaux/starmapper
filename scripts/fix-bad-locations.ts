// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * fix-bad-locations.ts
 *
 * Cleans up geocache entries and github_user lat/lng for HIGH-severity bad patterns:
 *   1. IP addresses / network strings (127.0.0.1, 0.0.0.0, 8.8.8.8...)
 *   2. Pure timezone codes (UTC, GMT+5, CET, IST...)
 *   3. Filesystem paths (/dev/null, /home/user, /etc/...)
 *   4. Fictional / tech-humor locations (the internet, cyberspace, mordor...)
 *
 * These were previously geocoded to arbitrary real-world places.
 * After running this script, affected users will be re-geocoded correctly
 * (or left unmapped) on the next scan.
 *
 * Usage:
 *   pnpm exec tsx scripts/fix-bad-locations.ts --dry-run   # preview
 *   pnpm exec tsx scripts/fix-bad-locations.ts             # apply
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

// Geocache keys are already lowercased — patterns use lowercase.
// github_user.location is mixed case — patterns use case-insensitive matching.
const CATEGORIES: Array<{
  name: string;
  geocacheRegex?: string;     // PostgreSQL regex for geocache.key (lowercase)
  userRegex?: string;         // PostgreSQL regex for github_user.location (case-insensitive)
  exactList?: string[];       // Exact lowercase matches (geocache) / case-insensitive (user)
}> = [
  {
    name: "IP addresses / network strings",
    geocacheRegex: String.raw`^\d{1,3}\.\d{1,3}(\.\d{1,3}){0,2}(\/\d+)?$`,
    userRegex:     String.raw`^\d{1,3}\.\d{1,3}(\.\d{1,3}){0,2}(\/\d+)?$`,
  },
  {
    name: "Pure timezone codes (no geographic context)",
    geocacheRegex: String.raw`^(utc|gmt|cet|cest|eet|eest|ist|est|pst|mst|cst|cdt|edt|pdt|mdt|jst|bst|aest|nzst|wat|cat|eat|wet|art|nst|ast|hst|akst|sgt|hkt|ict|wib|wit|wita)([+-]\d{1,2}(:\d{2})?)?$`,
    userRegex:     String.raw`^(utc|gmt|cet|cest|eet|eest|ist|est|pst|mst|cst|cdt|edt|pdt|mdt|jst|bst|aest|nzst|wat|cat|eat|wet|art|nst|ast|hst|akst|sgt|hkt|ict|wib|wit|wita)([+-]\d{1,2}(:\d{2})?)?$`,
  },
  {
    name: "Filesystem paths (/dev, /home, /etc...)",
    geocacheRegex: String.raw`^\/[a-z]`,
    userRegex:     String.raw`^\/[a-zA-Z]`,
  },
  {
    name: "Fictional / tech-humor locations",
    exactList: [
      "the internet", "internet", "cyberspace", "the matrix", "matrix",
      "mordor", "narnia", "hogwarts", "middle earth", "cloud", "the cloud",
      "digital nomad", "planet earth", "the void", "null island", "the moon",
      "mars", "universe", "localhost",
    ],
  },
];

type CountResult = { count: bigint };
type UserResult  = { login: string; location: string };

const main = async () => {
  console.log(`\n=== Fix Bad Locations ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}\n`);

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  let totalCacheDeleted = 0;
  let totalUsersFixed = 0;

  try {
    for (const cat of CATEGORIES) {
      console.log(`\n── ${cat.name} ──`);

      if (cat.geocacheRegex) {
        const [cacheCount] = await prisma.$queryRaw<CountResult[]>`
          SELECT COUNT(*) FROM geocache
          WHERE lat IS NOT NULL AND key ~ ${cat.geocacheRegex}
        `;
        console.log(`  Geocache entries (non-null): ${cacheCount.count}`);

        const sample = await prisma.$queryRaw<{ key: string; lat: number; lng: number }[]>`
          SELECT key, lat::float, lng::float FROM geocache
          WHERE lat IS NOT NULL AND key ~ ${cat.geocacheRegex}
          LIMIT 5
        `;
        for (const r of sample) {
          console.log(`    "${r.key}" → ${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}`);
        }

        const [userCount] = await prisma.$queryRaw<CountResult[]>`
          SELECT COUNT(*) FROM github_user
          WHERE lat IS NOT NULL AND location ~* ${cat.userRegex ?? cat.geocacheRegex}
        `;
        console.log(`  github_user rows to null: ${userCount.count}`);

        if (!DRY_RUN) {
          await prisma.$executeRaw`
            DELETE FROM geocache WHERE lat IS NOT NULL AND key ~ ${cat.geocacheRegex}
          `;
          const fixed = await prisma.$executeRaw`
            UPDATE github_user SET lat = NULL, lng = NULL
            WHERE lat IS NOT NULL AND location ~* ${cat.userRegex ?? cat.geocacheRegex}
          `;
          totalCacheDeleted += Number(cacheCount.count);
          totalUsersFixed += fixed;
        } else {
          totalCacheDeleted += Number(cacheCount.count);
          totalUsersFixed += Number(userCount.count);
        }
      }

      if (cat.exactList) {
        const lowerList = cat.exactList;

        // geocache keys are already lowercase
        const cacheEntries = await prisma.geoCache.findMany({
          where: { key: { in: lowerList }, lat: { not: null } },
          select: { key: true, lat: true, lng: true },
        });
        console.log(`  Geocache entries (non-null): ${cacheEntries.length}`);
        for (const r of cacheEntries.slice(0, 5)) {
          console.log(`    "${r.key}" → ${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}`);
        }

        // github_user.location is mixed case — use ILIKE for each item
        const userMatches = await prisma.$queryRaw<UserResult[]>`
          SELECT login, location FROM github_user
          WHERE lat IS NOT NULL
          AND LOWER(TRIM(location)) = ANY(${lowerList}::text[])
          LIMIT 20
        `;
        const [userCount] = await prisma.$queryRaw<CountResult[]>`
          SELECT COUNT(*) FROM github_user
          WHERE lat IS NOT NULL
          AND LOWER(TRIM(location)) = ANY(${lowerList}::text[])
        `;
        console.log(`  github_user rows to null: ${userCount.count}`);
        for (const u of userMatches.slice(0, 5)) {
          console.log(`    @${u.login} — "${u.location}"`);
        }

        if (!DRY_RUN) {
          await prisma.geoCache.deleteMany({
            where: { key: { in: lowerList }, lat: { not: null } },
          });
          await prisma.$executeRaw`
            UPDATE github_user SET lat = NULL, lng = NULL
            WHERE lat IS NOT NULL
            AND LOWER(TRIM(location)) = ANY(${lowerList}::text[])
          `;
          totalCacheDeleted += cacheEntries.length;
          totalUsersFixed += Number(userCount.count);
        } else {
          totalCacheDeleted += cacheEntries.length;
          totalUsersFixed += Number(userCount.count);
        }
      }
    }

    console.log(`\n=== Summary ===`);
    if (DRY_RUN) {
      console.log(`  Would delete ${totalCacheDeleted} geocache entries`);
      console.log(`  Would null lat/lng for ${totalUsersFixed} github_user rows`);
    } else {
      console.log(`  Deleted ${totalCacheDeleted} geocache entries`);
      console.log(`  Nulled lat/lng for ${totalUsersFixed} github_user rows`);
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
