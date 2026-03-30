// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { prisma } from "@/lib/db";

type DbHealth = { ok: true; usagePct: number } | { ok: false };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Configurable via DB_STORAGE_LIMIT_MB env var (default 512 for free tier, set 10240 for Launch plan)
const DB_MAX_BYTES = (parseInt(process.env.DB_STORAGE_LIMIT_MB ?? "512") || 512) * 1024 * 1024;

let cached: { health: DbHealth; ts: number } | null = null;

export const checkDbHealth = async (): Promise<DbHealth> => {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.health;

  try {
    const result = await prisma.$queryRaw<[{ size: bigint }]>`
      SELECT pg_database_size(current_database()) AS size
    `;
    const bytes = Number(result[0].size);
    const usagePct = Math.round((bytes / DB_MAX_BYTES) * 100);
    const health: DbHealth = { ok: true, usagePct };
    cached = { health, ts: Date.now() };
    return health;
  } catch {
    const health: DbHealth = { ok: false };
    cached = { health, ts: Date.now() };
    return health;
  }
};

export const DB_WARN_PCT = 80;
export const DB_CRITICAL_PCT = 95;
