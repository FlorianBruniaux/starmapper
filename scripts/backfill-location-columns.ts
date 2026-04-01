// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// One-shot: backfill countryNormalized / cityNormalized on existing github_user rows.
// Idempotent — only processes rows where countryNormalized IS NULL.
// Run: pnpm backfill:locations

import { prisma } from "@/lib/db";
import { parseLocation } from "@/lib/location-parser";

const BATCH_SIZE = 1000;

const main = async () => {
  console.log("Backfilling countryNormalized / cityNormalized...");
  let processed = 0;
  let cursor: string | undefined;

  while (true) {
    const users = await prisma.gitHubUser.findMany({
      where: { location: { not: null }, countryNormalized: null },
      select: { login: true, location: true },
      take: BATCH_SIZE,
      orderBy: { login: "asc" },
      ...(cursor ? { cursor: { login: cursor }, skip: 1 } : {}),
    });

    if (!users.length) break;

    const logins: string[]   = [];
    const countries: (string | null)[] = [];
    const cities: (string | null)[]    = [];

    for (const u of users) {
      const { country, city } = parseLocation(u.location);
      logins.push(u.login);
      countries.push(country);
      cities.push(city);
    }

    // Single UPDATE per batch via UNNEST — avoids N round-trips
    await prisma.$executeRaw`
      UPDATE github_user SET
        "countryNormalized" = v.country,
        "cityNormalized"    = v.city
      FROM (
        SELECT
          unnest(${logins}::text[])    AS login,
          unnest(${countries}::text[]) AS country,
          unnest(${cities}::text[])    AS city
      ) v
      WHERE github_user.login = v.login
    `;

    processed += users.length;
    cursor = users[users.length - 1].login;
    process.stdout.write(`\r  ${processed} users processed...`);
  }

  console.log(`\nDone — ${processed} rows backfilled.`);
  await prisma.$disconnect();
};

main().catch((err) => { console.error(err); process.exit(1); });
