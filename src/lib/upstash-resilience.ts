// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shared Redis.fromEnv() config for every Upstash client in the app (proxy.ts,
// github-auth.ts, geo/route.ts). The SDK default is 5 retries with exponential
// backoff (up to ~1.6s of retrying) and no request timeout — a stalled or slow
// Redis multiplies a single logical rate-limit check into several billed HTTP
// round trips, which is the amplification path that turned the 2026-07-26
// scraping burst into a full Upstash Free Tier quota exhaustion (500k/month).
// One retry and a short timeout bound the worst case to ~2 requests, fast.
export const UPSTASH_CLIENT_CONFIG = {
  retry: {
    retries: 1,
    backoff: () => 100,
  },
  signal: () => AbortSignal.timeout(1500),
} as const;
