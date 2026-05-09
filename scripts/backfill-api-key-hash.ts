// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// One-shot: compute SHA-256(key) for every api_key row that has no keyHash yet.
// Run once on each DB instance (local + Neon prod):
//
//   DATABASE_DRIVER=standard DATABASE_URL=<pg_url> npx tsx scripts/backfill-api-key-hash.ts

import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const hashKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

const rows = await prisma.apiKey.findMany({
  where: { keyHash: null },
  select: { key: true },
});

if (rows.length === 0) {
  console.log("No rows to backfill — all api_key rows already have keyHash.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`Backfilling ${rows.length} api_key rows...`);

let updated = 0;
for (const row of rows) {
  await prisma.apiKey.update({
    where: { key: row.key },
    data: { keyHash: hashKey(row.key) },
  });
  updated++;
}

console.log(`Done — updated ${updated} rows.`);
await prisma.$disconnect();
