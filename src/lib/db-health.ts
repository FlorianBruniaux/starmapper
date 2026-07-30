// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { prisma } from "@/lib/db";

type DbHealth = { ok: true; usagePct: number } | { ok: false };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — success is slow-moving, safe to cache long
// A transient Neon blip (one failed query) must not stick for 5 minutes: while unhealthy,
// user-cache.ts silently skips every GitHubUser/StarEvent write. Retrying in 10s bounds the
// blast radius of a 1s network hiccup to ~10s of dropped writes instead of 5 minutes.
const FAILURE_CACHE_TTL_MS = 10 * 1000; // 10 seconds
const DB_MAX_BYTES = 100 * 1024 * 1024 * 1024; // 100 GB — Neon sponsored plan

let cached: { health: DbHealth; ts: number } | null = null;

export const checkDbHealth = async (): Promise<DbHealth> => {
  if (cached) {
    const ttl = cached.health.ok ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.health;
  }

  try {
    const result = await prisma.$queryRaw<[{ size: bigint }]>`
      SELECT pg_database_size(current_database()) AS size
    `;
    const bytes = Number(result[0].size);
    const usagePct = Math.round((bytes / DB_MAX_BYTES) * 100);
    const health: DbHealth = { ok: true, usagePct };
    cached = { health, ts: Date.now() };
    return health;
  } catch (err) {
    console.warn(`[db-health] check failed, retrying in ${FAILURE_CACHE_TTL_MS}ms:`, err);
    const health: DbHealth = { ok: false };
    cached = { health, ts: Date.now() };
    return health;
  }
};

export const DB_WARN_PCT = 80;
export const DB_CRITICAL_PCT = 95;
