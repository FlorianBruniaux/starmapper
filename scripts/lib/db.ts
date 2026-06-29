// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Shared Prisma client factory for scripts.
 *
 * Scripts run long-lived TCP connections (pg adapter) which are incompatible with
 * Neon's PgBouncer pooler: the pooler rejects `statement_timeout` as a startup
 * parameter (error 08P01). This helper converts a pooler URL to a direct URL
 * transparently, so scripts work regardless of which DATABASE_URL variant is set.
 *
 * Pooler URL: ep-xxx-pooler.region.aws.neon.tech  (pgbouncer=true)
 * Direct URL: ep-xxx.region.aws.neon.tech          (no pgbouncer param)
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

/**
 * Convert a Neon pooler URL to a direct connection URL.
 * No-op for non-pooler URLs (Docker, Railway, plain Postgres).
 */
export const toDirectUrl = (url: string): string => {
  if (!url.includes("pgbouncer=true")) return url;

  const u = new URL(url);
  u.hostname = u.hostname.replace(/-pooler(\.\w)/, "$1");
  u.searchParams.delete("pgbouncer");
  u.searchParams.delete("connect_timeout");
  return u.toString();
};

/**
 * Create a PrismaClient using the pg TCP adapter.
 * Automatically converts pooler URLs to direct URLs.
 * Sets statement_timeout=0 to disable query timeouts for long-running scripts.
 */
export const createScriptPrisma = (databaseUrl?: string): PrismaClient => {
  const raw = databaseUrl ?? process.env.DATABASE_URL ?? "";
  if (!raw) throw new Error("DATABASE_URL is not set");

  const directUrl = toDirectUrl(raw);
  const pool = new pg.Pool({ connectionString: directUrl, options: "-c statement_timeout=0" });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
};
