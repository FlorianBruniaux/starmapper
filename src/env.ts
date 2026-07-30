// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Database — required; without this the entire app is non-functional
    DATABASE_URL: z.string().min(1),
    DATABASE_DRIVER: z.enum(["neon", "standard"]).default("neon"),

    // GitHub API — required for stargazer fetches; unauthenticated fallback (60 req/hr) is
    // not viable in production for any repo with more than a few hundred stars
    GITHUB_TOKEN: z.string().min(1),

    // Geocoding providers (optional — falls back to Nominatim if absent)
    // The _2 variants are secondary Jawg accounts, used automatically when the primary
    // token returns a quota or auth error (401, 402, 403, 429). See src/lib/jawg-token.ts.
    JAWG_TOKEN_HEADER: z.string().optional(),
    JAWG_TOKEN_HEADER_2: z.string().optional(),
    JAWGMAP_ACCESS_TOKEN: z.string().optional(),
    JAWGMAP_ACCESS_TOKEN_2: z.string().optional(),
    GEOAPIFY_APIKEY: z.string().optional(),

    // Security — optional but strongly recommended in production
    SM_TOKEN_SECRET: z.string().min(32).optional(),
    CACHE_SIGN_SECRET: z.string().min(16).optional(),
    IP_HASH_SECRET: z.string().min(16).optional(),

    // Upstash Redis — required for distributed rate limiting in production
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Feature flags + admin
    ADMIN_SECRET: z.string().min(16).optional(),
    ADMIN_ALLOWED_IPS: z.string().optional(),
    CRON_SECRET: z.string().min(16).optional(),
    ORGANIC_SCORE_ENABLED: z.string().optional(),
    // Serves GET /api/stats/[owner]/[repo] from the four repo_*_mv instead of the live
    // joins. Requires views 10 to 13 of prisma/sql/views.sql to be applied first.
    // Plain string, not a boolean: z.coerce.boolean() would make Boolean("false") true,
    // so REPO_STATS_MV_ENABLED=false could never turn it off and the rollback path would
    // be dead. Compared with === "true" at the call site, like the six other flags here.
    REPO_STATS_MV_ENABLED: z.string().optional(),

    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  client: {
    // Map tiles — required; without this the map cannot render
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN: z.string().min(1),

    // Optional client vars
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2: z.string().optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_CSV_EXPORT: z.string().optional(),
    NEXT_PUBLIC_ENABLE_GLOBE: z.string().optional(),
    NEXT_PUBLIC_ORGANIC_SCORE_ENABLED: z.string().optional(),
    NEXT_PUBLIC_DEPENDENTS_ENABLED: z.string().optional(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN: process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN,
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2: process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CSV_EXPORT: process.env.NEXT_PUBLIC_CSV_EXPORT,
    NEXT_PUBLIC_ENABLE_GLOBE: process.env.NEXT_PUBLIC_ENABLE_GLOBE,
    NEXT_PUBLIC_ORGANIC_SCORE_ENABLED: process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED,
    NEXT_PUBLIC_DEPENDENTS_ENABLED: process.env.NEXT_PUBLIC_DEPENDENTS_ENABLED,
  },
  emptyStringAsUndefined: true,
});
