-- StarMapper — One-time DB setup: materialized views + indexes
-- Run: pnpm setup:mvs        (local, loads .env.local)
--      pnpm setup:mvs:prod   (production, DATABASE_URL must be set in shell)
--
-- Idempotent: safe to run multiple times (IF NOT EXISTS everywhere).
-- IMPORTANT: CREATE INDEX without CONCURRENTLY — holds write lock during build.
--            On 4M+ rows this takes 2-5min. Run during low-traffic window.
-- NOTE: CONCURRENTLY is incompatible with Neon storage (SMGR panic) — never use it here.

SET statement_timeout = 0;

-- ============================================================
-- Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Indexes (non-MV)
-- ============================================================

-- GIN trigram indexes for ILIKE '%search%' on login + name (~50ms vs ~6s seq scan on 4M rows)
CREATE INDEX IF NOT EXISTS github_user_login_trgm_idx
  ON github_user USING gin (login gin_trgm_ops);

CREATE INDEX IF NOT EXISTS github_user_name_trgm_idx
  ON github_user USING gin (name gin_trgm_ops);

-- Speed up time-window queries on star_event (used by trending_repos_mv)
CREATE INDEX IF NOT EXISTS star_event_starred_at_idx
  ON star_event ("starredAt");

-- Per-user star timeline: WHERE login ORDER BY starredAt DESC (profile page, /api/user star history).
-- Created here (not via prisma db push) because building a btree on ~12M rows exceeds Neon's
-- default statement_timeout — this file runs with SET statement_timeout = 0.
-- Name MUST match Prisma's auto-generated name so `prisma db push` sees it as already-present.
CREATE INDEX IF NOT EXISTS "star_event_login_starredAt_idx"
  ON star_event (login, "starredAt" DESC);

-- ============================================================
-- 1. github_user_grid_mv
-- ============================================================
-- Global heatmap grid: lat/lng buckets (0.5° resolution) with follower aggregation.
-- Powers /api/explore/global-map. Refresh: daily cron + /api/admin/refresh-grid-mv.

CREATE MATERIALIZED VIEW IF NOT EXISTS github_user_grid_mv AS
  SELECT
    ROUND(lat::numeric, 1)::float                             AS lat,
    ROUND(lng::numeric, 1)::float                             AS lng,
    COUNT(*)::int                                             AS count,
    SUM(followers)::bigint                                    AS total_followers,
    (array_agg(login ORDER BY followers DESC NULLS LAST))[1]  AS top_login
  FROM github_user
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
  GROUP BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1);

CREATE UNIQUE INDEX IF NOT EXISTS github_user_grid_mv_lat_lng_idx
  ON github_user_grid_mv (lat, lng);

-- ============================================================
-- 2. country_stats_mv
-- ============================================================
-- Pre-aggregated country counts for the Explore page.
-- Without this MV, /api/explore falls back to a full DISTINCT scan (~9s on 4M rows).

CREATE MATERIALIZED VIEW IF NOT EXISTS country_stats_mv AS
  SELECT "countryNormalized" AS country, COUNT(*) AS cnt
  FROM github_user
  WHERE "countryNormalized" IS NOT NULL
    AND "countryNormalized" NOT LIKE 'http%'
  GROUP BY "countryNormalized"
  ORDER BY cnt DESC;

CREATE UNIQUE INDEX IF NOT EXISTS country_stats_mv_country_idx
  ON country_stats_mv (country);

-- ============================================================
-- 3. power_users_mv
-- ============================================================
-- Star event aggregation: users who starred more than 1 repo tracked by StarMapper.
-- Replaces timeout on 11.9M rows, fixes Power tab in Explore.

CREATE MATERIALIZED VIEW IF NOT EXISTS power_users_mv AS
  SELECT login, COUNT(*) AS cnt
  FROM star_event
  GROUP BY login
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC, login ASC;

CREATE UNIQUE INDEX IF NOT EXISTS power_users_mv_login_idx
  ON power_users_mv (login);

CREATE INDEX IF NOT EXISTS power_users_mv_cnt_login_idx
  ON power_users_mv (cnt DESC, login ASC);

-- ============================================================
-- 4. company_stats_mv
-- ============================================================
-- Company aggregation for Explore company filter (~9s → ~50ms on 4M rows).

CREATE MATERIALIZED VIEW IF NOT EXISTS company_stats_mv AS
  SELECT company, COUNT(*) AS cnt
  FROM github_user
  WHERE company IS NOT NULL AND company <> ''
  GROUP BY company
  ORDER BY cnt DESC;

CREATE UNIQUE INDEX IF NOT EXISTS company_stats_mv_company_idx
  ON company_stats_mv (company);

-- ============================================================
-- 5. country_language_stats_mv
-- ============================================================
-- (country × language) counts for Language Atlas (/devs/atlas).
-- One row per country+language pair. Requires lat IS NOT NULL (geocoded users only).

CREATE MATERIALIZED VIEW IF NOT EXISTS country_language_stats_mv AS
  SELECT
    "countryNormalized" AS country,
    lang,
    COUNT(*)::int AS cnt
  FROM github_user, unnest(languages) AS lang
  WHERE "countryNormalized" IS NOT NULL
    AND "countryNormalized" NOT LIKE 'http%'
    AND languages IS NOT NULL
    AND lat IS NOT NULL
  GROUP BY "countryNormalized", lang;

CREATE UNIQUE INDEX IF NOT EXISTS country_language_stats_mv_pk_idx
  ON country_language_stats_mv (country, lang);

CREATE INDEX IF NOT EXISTS country_language_stats_mv_lang_idx
  ON country_language_stats_mv (lang);

-- ============================================================
-- 6. user_repo_count_mv
-- ============================================================
-- Per-user count of tracked repos. Replaces expensive LEFT JOIN in nearby query (6s → ~200ms).

CREATE MATERIALIZED VIEW IF NOT EXISTS user_repo_count_mv AS
  SELECT login, COUNT(*) AS repo_count
  FROM star_event
  GROUP BY login;

CREATE UNIQUE INDEX IF NOT EXISTS user_repo_count_mv_login_idx
  ON user_repo_count_mv (login);

-- ============================================================
-- 7. language_grid_mv
-- ============================================================
-- Pre-computed lat/lng grid per language for /devs/[language] map endpoint.
-- Replaces GROUP BY + array_agg on 4.4M github_user rows per request.

CREATE MATERIALIZED VIEW IF NOT EXISTS language_grid_mv AS
  SELECT
    lang,
    ROUND(lat::numeric, 1)::float                             AS lat,
    ROUND(lng::numeric, 1)::float                             AS lng,
    COUNT(*)::int                                             AS cnt,
    (array_agg(login ORDER BY followers DESC NULLS LAST))[1]  AS top_login
  FROM github_user, unnest(languages) AS lang
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND languages IS NOT NULL
  GROUP BY lang, ROUND(lat::numeric, 1), ROUND(lng::numeric, 1);

CREATE UNIQUE INDEX IF NOT EXISTS language_grid_mv_pk_idx
  ON language_grid_mv (lang, lat, lng);

CREATE INDEX IF NOT EXISTS language_grid_mv_lang_idx
  ON language_grid_mv (lang);

-- ============================================================
-- 8. trending_repos_mv
-- ============================================================
-- Top repos by star velocity (7/30/90-day windows). Powers /api/trending.
-- Refresh: daily cron + /api/admin/refresh-grid-mv.

CREATE MATERIALIZED VIEW IF NOT EXISTS trending_repos_mv AS
  SELECT
    se.owner,
    se.repo,
    COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '7 days')  AS stars_7d,
    COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '30 days') AS stars_30d,
    COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '90 days') AS stars_90d,
    bc.language,
    bc."totalCount"
  FROM star_event se
  JOIN badge_cache bc ON bc.owner = se.owner AND bc.repo = se.repo
  WHERE bc."totalCount" >= 50
  GROUP BY se.owner, se.repo, bc.language, bc."totalCount"
  HAVING COUNT(*) FILTER (WHERE se."starredAt" > NOW() - INTERVAL '30 days') > 0
  ORDER BY stars_7d DESC
  LIMIT 200;

CREATE UNIQUE INDEX IF NOT EXISTS trending_repos_mv_owner_repo_idx
  ON trending_repos_mv (owner, repo);

CREATE INDEX IF NOT EXISTS trending_repos_mv_stars_7d_idx
  ON trending_repos_mv (stars_7d DESC);

-- ============================================================
-- 9. city_stats_mv
-- ============================================================
-- Per-city counts + centroid for the "nearby cities" panel (/api/explore/nearby).
-- Replaces a live GROUP BY + Haversine over millions of github_user rows (~1s) with
-- a scan of distinct city buckets (~tens of thousands of rows).
--
-- Grouped by (city, 1° lat bucket, 1° lng bucket) so same-named cities far apart
-- (Paris FR vs Paris TX) stay separate. Country is intentionally NOT in the key —
-- inconsistent countryNormalized would otherwise split a single physical city.
-- cnt is the global city size (cities are point-like at 1-decimal precision, so for
-- a radius ≥ 25km a city is effectively all-in or all-out of the search circle).

CREATE MATERIALIZED VIEW IF NOT EXISTS city_stats_mv AS
  SELECT
    "cityNormalized"                    AS city,
    ROUND(lat::numeric, 0)::float       AS lat_bucket,
    ROUND(lng::numeric, 0)::float       AS lng_bucket,
    ROUND(AVG(lat)::numeric, 1)::float  AS lat,
    ROUND(AVG(lng)::numeric, 1)::float  AS lng,
    COUNT(*)::int                       AS cnt
  FROM github_user
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND "cityNormalized" IS NOT NULL
  GROUP BY "cityNormalized", ROUND(lat::numeric, 0), ROUND(lng::numeric, 0);

CREATE UNIQUE INDEX IF NOT EXISTS city_stats_mv_pk_idx
  ON city_stats_mv (city, lat_bucket, lng_bucket);

CREATE INDEX IF NOT EXISTS city_stats_mv_lat_lng_idx
  ON city_stats_mv (lat, lng);
