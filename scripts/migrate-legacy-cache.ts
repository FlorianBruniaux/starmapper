// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
// One-shot: compress legacy stargazer_cache rows (jsonb array → gzip+base64 string).
// Run against prod: DATABASE_URL_LOCAL=$DATABASE_URL pnpm exec tsx scripts/migrate-legacy-cache.ts

import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

const url = process.env.DATABASE_URL_LOCAL ?? process.env.DATABASE_URL ?? "";
if (!url) { console.error("Error: DATABASE_URL_LOCAL not set"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url });

const main = async () => {
  const { rows } = await pool.query(
    `SELECT owner, repo, points, unmapped FROM stargazer_cache WHERE jsonb_typeof(points) = 'array'`
  );
  console.log(`Found ${rows.length} legacy rows to migrate`);

  for (const row of rows) {
    const pointsGz   = gzipSync(JSON.stringify(row.points)).toString("base64");
    const unmappedGz = gzipSync(JSON.stringify(row.unmapped)).toString("base64");
    await pool.query(
      `UPDATE stargazer_cache SET points = $1::jsonb, unmapped = $2::jsonb WHERE owner = $3 AND repo = $4`,
      [JSON.stringify(pointsGz), JSON.stringify(unmappedGz), row.owner, row.repo]
    );
    console.log(`  migrated ${row.owner}/${row.repo}`);
  }

  const { rows: check } = await pool.query(
    `SELECT COUNT(*) FROM stargazer_cache WHERE jsonb_typeof(points) = 'array'`
  );
  console.log(`\nLegacy rows remaining: ${check[0].count}`);
  await pool.end();
};

main().catch(err => { console.error(err); process.exit(1); });
