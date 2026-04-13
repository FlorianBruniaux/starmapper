// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * clean-geocache-garbage.ts
 *
 * Removes garbage entries from the geocache: hashtags, shell vars, XSS attempts,
 * JS objects, template strings, IPv6, etc.
 *
 * Usage:
 *   pnpm exec tsx scripts/clean-geocache-garbage.ts --dry-run   # preview
 *   pnpm exec tsx scripts/clean-geocache-garbage.ts             # delete
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

// Patterns that indicate a non-geocodeable garbage key
const isGarbage = (key: string): boolean => {
  // Hashtag / social tags: #pnw, #yeg, #pak
  if (key.startsWith("#")) return true;
  // Shell variables: $home, $pwd, $path
  if (key.startsWith("$")) return true;
  // XSS / HTML / angle brackets: ><s>, <html>, > /dev/null
  if (key.startsWith("<") || key.startsWith(">")) return true;
  // Array/object literals: [object Object], [::1], [ ...canton ]
  if (key.startsWith("[")) return true;
  // Template literals / object notation: { kyoto }, {{ user.location }}
  if (key.startsWith("{")) return true;
  // Backslash escape sequences: \f.\x.fxx
  if (key.startsWith("\\")) return true;
  // Quoted strings: "high north", "silicorn" valley
  if (key.startsWith('"')) return true;
  // Exclamation marks: !universe!
  if (key.startsWith("!")) return true;
  return false;
};

const main = async () => {
  console.log(`\n=== Geocache Garbage Cleaner ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "DELETE"}\n`);

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const total = await prisma.geoCache.count();
    console.log(`Geocache total: ${total} entries`);

    // Fetch candidates in batches (can't do regex server-side easily via Prisma)
    // Fetch all keys and filter client-side — geocache is ~50k rows, manageable
    console.log("Scanning all keys...");
    const allKeys = await prisma.geoCache.findMany({ select: { key: true } });

    const garbageKeys = allKeys.map((r) => r.key).filter(isGarbage);
    console.log(`Found ${garbageKeys.length} garbage entries:`);
    for (const k of garbageKeys) console.log(`  - "${k}"`);

    if (garbageKeys.length === 0) {
      console.log("\nNothing to delete.");
      return;
    }

    if (DRY_RUN) {
      console.log(`\nDry-run: would delete ${garbageKeys.length} entries.`);
      return;
    }

    const result = await prisma.geoCache.deleteMany({
      where: { key: { in: garbageKeys } },
    });

    const after = await prisma.geoCache.count();
    console.log(`\n=== Done ===`);
    console.log(`  Deleted: ${result.count}`);
    console.log(`  Geocache: ${total} → ${after}`);
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
