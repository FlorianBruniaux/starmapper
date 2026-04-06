// SPDX-License-Identifier: AGPL-3.0-only
// One-shot migration: fix countryNormalized rows that contain LinkedIn URLs.
//
// Root cause: ~113k github_user rows have a LinkedIn URL stored in countryNormalized
// instead of linkedinUrl, due to a data corruption bug during an earlier migration window.
//
// What this script does:
//   1. For affected rows (countryNormalized LIKE 'http%'):
//      - Copies the URL to linkedinUrl (if linkedinUrl is currently NULL)
//      - Sets countryNormalized = NULL (will be re-populated by next backfill)
//   2. Reports counts before/after.
//
// Run against production:
//   DATABASE_URL="<prod_url>" DATABASE_DRIVER=standard npx tsx scripts/fix-country-normalized-linkedin.ts
//
// Safe to re-run — idempotent (WHERE countryNormalized LIKE 'http%' matches nothing after fix).

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const main = async () => {
  // 1. Count affected rows
  const [{ count: affected }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM github_user
    WHERE "countryNormalized" LIKE 'http%'
  `;
  console.log(`Affected rows (LinkedIn URL in countryNormalized): ${Number(affected)}`);

  if (Number(affected) === 0) {
    console.log("Nothing to fix — already clean.");
    await prisma.$disconnect();
    return;
  }

  // 2. Move URLs to linkedinUrl where it is currently NULL, then clear countryNormalized
  const result = await prisma.$executeRaw`
    UPDATE github_user
    SET
      "linkedinUrl" = CASE
        WHEN "linkedinUrl" IS NULL THEN "countryNormalized"
        ELSE "linkedinUrl"
      END,
      "countryNormalized" = NULL
    WHERE "countryNormalized" LIKE 'http%'
  `;
  console.log(`Updated ${result} rows.`);

  // 3. Verify
  const [{ count: remaining }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM github_user
    WHERE "countryNormalized" LIKE 'http%'
  `;
  console.log(`Remaining corrupted rows: ${Number(remaining)}`);

  const [{ count: distinct }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "countryNormalized") AS count
    FROM github_user
    WHERE "countryNormalized" IS NOT NULL AND "countryNormalized" NOT LIKE 'http%'
  `;
  console.log(`Distinct countries after fix: ${Number(distinct)}`);

  await prisma.$disconnect();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
