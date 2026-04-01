// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// One-shot: create github_user_grid_mv materialized view + unique index.
// Idempotent — safe to re-run (uses IF NOT EXISTS).
// Run: pnpm create:grid-mv

import { prisma } from "@/lib/db";

const main = async () => {
  console.log("Creating materialized view github_user_grid_mv...");

  await prisma.$executeRaw`
    CREATE MATERIALIZED VIEW IF NOT EXISTS github_user_grid_mv AS
    SELECT
      ROUND(lat::numeric, 0)::float8                               AS lat,
      ROUND(lng::numeric, 0)::float8                               AS lng,
      COUNT(*)::int                                                 AS count,
      COALESCE(SUM(followers), 0)::int                             AS total_followers,
      (ARRAY_AGG(login ORDER BY followers DESC NULLS LAST))[1]     AS top_login
    FROM github_user
    WHERE lat IS NOT NULL AND lng IS NOT NULL
    GROUP BY ROUND(lat::numeric, 0), ROUND(lng::numeric, 0)
  `;

  console.log("Creating unique index on (lat, lng)...");
  await prisma.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS github_user_grid_mv_lat_lng_idx
    ON github_user_grid_mv (lat, lng)
  `;

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM github_user_grid_mv
  `;
  console.log(`Done — ${Number(count)} grid cells in the view.`);
  await prisma.$disconnect();
};

main().catch((err) => { console.error(err); process.exit(1); });
