// SPDX-License-Identifier: AGPL-3.0-only
// One-time DB setup: materialized views + indexes for StarMapper.
//
// Reads prisma/sql/views.sql and executes it against DATABASE_URL.
// Idempotent — safe to run multiple times (IF NOT EXISTS everywhere).
//
//   pnpm setup:mvs        (local, loads .env.local)
//   pnpm setup:mvs:prod   (production, DATABASE_URL must be set in shell)

import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sqlPath = join(import.meta.dirname, "..", "..", "prisma", "sql", "views.sql");
const sql = readFileSync(sqlPath, "utf-8");

const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();

try {
  console.log("Running prisma/sql/views.sql …");
  const start = Date.now();
  await client.query(sql);
  console.log(`Done in ${Date.now() - start}ms.`);
} finally {
  client.release();
  await pool.end();
}
