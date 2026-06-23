-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

-- country_language_stats_mv
-- One row per (country × language) — count of geocoded github_user rows where
-- that language appears in languages[] (all positions, equal weight).
--
-- Requires: lat IS NOT NULL (only geocoded users — same filter as /api/devs)
--
-- Run once manually on each DB instance (local + prod).
-- UNIQUE INDEX on (country, lang) is mandatory for REFRESH CONCURRENTLY.

SET statement_timeout = 0;

CREATE MATERIALIZED VIEW country_language_stats_mv AS
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

CREATE UNIQUE INDEX country_language_stats_mv_pk_idx
  ON country_language_stats_mv (country, lang);

CREATE INDEX country_language_stats_mv_lang_idx
  ON country_language_stats_mv (lang);

-- Verify:
-- SELECT COUNT(*) FROM country_language_stats_mv;
-- SELECT country, lang, cnt
-- FROM country_language_stats_mv
-- WHERE country IN ('France', 'United States')
-- ORDER BY country, cnt DESC LIMIT 20;
