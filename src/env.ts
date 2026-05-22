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
    JAWG_TOKEN_HEADER: z.string().optional(),
    JAWGMAP_ACCESS_TOKEN: z.string().optional(),
    GEOAPIFY_APIKEY: z.string().optional(),

    // Security — optional but strongly recommended in production
    SM_TOKEN_SECRET: z.string().min(32).optional(),
    CACHE_SIGN_SECRET: z.string().optional(),

    // Upstash Redis — required for distributed rate limiting in production
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Feature flags + admin
    ADMIN_SECRET: z.string().optional(),
    ADMIN_ALLOWED_IPS: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    ORGANIC_SCORE_ENABLED: z.string().optional(),

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
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN: process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN,
    NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2: process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN_2,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CSV_EXPORT: process.env.NEXT_PUBLIC_CSV_EXPORT,
    NEXT_PUBLIC_ENABLE_GLOBE: process.env.NEXT_PUBLIC_ENABLE_GLOBE,
    NEXT_PUBLIC_ORGANIC_SCORE_ENABLED: process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED,
  },
  emptyStringAsUndefined: true,
});
