// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import "@/env"; // fail-fast: validates DATABASE_URL + GITHUB_TOKEN at server startup
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { withVerifyFullSsl } from "@/lib/pg-ssl";

// createRequire allows CJS-style dynamic imports in an ESM package ("type":"module").
// Used only for the standard/pg driver path — never loaded on Vercel (Neon only).
const _require = createRequire(import.meta.url);

/**
 * DATABASE_DRIVER controls the Prisma connection mode:
 *   "neon"     — @prisma/adapter-neon (HTTP, required on Vercel + Neon Serverless). Default.
 *   "standard" — @prisma/adapter-pg   (TCP pool, Docker, Railway, Supabase, plain Postgres)
 *
 * Self-hosters on standard PostgreSQL: set DATABASE_DRIVER=standard in .env.
 * Both modes read DATABASE_URL for the connection string.
 *
 * @prisma/adapter-neon is a static import — loaded at module init time to reduce cold start latency.
 * @prisma/adapter-pg stays as require() — only used when DATABASE_DRIVER=standard (never on Vercel).
 */
const createPrismaClient = () => {
  // pgbouncer=true signals a Neon pooler URL — PgBouncer rejects TCP startup parameters
  // like statement_timeout. Force the HTTP adapter regardless of DATABASE_DRIVER.
  const isNeonPooler = process.env.DATABASE_URL?.includes("pgbouncer=true") ?? false;

  if (process.env.DATABASE_DRIVER === "standard" && !isNeonPooler) {
    const { Pool } = _require("pg") as typeof import("pg");
    const { PrismaPg } = _require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    const pool = new Pool({
      connectionString: withVerifyFullSsl(process.env.DATABASE_URL ?? ""),
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
    });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
  }

  // Default: Neon serverless adapter (HTTP-based, no persistent TCP connection).
  // Also used when DATABASE_DRIVER=standard but DATABASE_URL targets the Neon pooler.
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const _createAndConfigurePrisma = () => {
  const client = createPrismaClient();
  // P3.B — slow query logging: warn on any query > 1000ms in Vercel logs
  client.$on("query" as never, (e: { duration: number; query: string }) => {
    if (e.duration > 1000) console.warn(`[SLOW] ${e.duration}ms — ${e.query.slice(0, 200)}`);
  });
  return client;
};

export const prisma = globalForPrisma.prisma ?? _createAndConfigurePrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
