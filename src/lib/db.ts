// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { PrismaClient } from "@prisma/client";

/**
 * DATABASE_DRIVER controls the Prisma connection mode:
 *   "neon"     — @prisma/adapter-neon (HTTP, required on Vercel + Neon Serverless). Default.
 *   "standard" — @prisma/adapter-pg   (TCP pool, Docker, Railway, Supabase, plain Postgres)
 *
 * Self-hosters on standard PostgreSQL: set DATABASE_DRIVER=standard in .env.
 * Both modes read DATABASE_URL for the connection string.
 */
const createPrismaClient = () => {
  if (process.env.DATABASE_DRIVER === "standard") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
    });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  }

  // Default: Neon serverless adapter (HTTP-based, no persistent TCP connection)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaNeon } = require("@prisma/adapter-neon") as typeof import("@prisma/adapter-neon");
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
