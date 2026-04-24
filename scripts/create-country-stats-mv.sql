-- country_stats_mv — pre-aggregated country counts for the Explore page.
-- Without this MV, the /api/explore route falls back to a full DISTINCT scan (~9s on 4M rows).
-- Run once per DB instance, then refresh via the daily cron or pnpm refresh:country-stats-mv.

SET statement_timeout = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS country_stats_mv AS
  SELECT "countryNormalized" AS country, COUNT(*) AS cnt
  FROM github_user
  WHERE "countryNormalized" IS NOT NULL
    AND "countryNormalized" NOT LIKE 'http%'
  GROUP BY "countryNormalized"
  ORDER BY cnt DESC;

CREATE UNIQUE INDEX IF NOT EXISTS country_stats_mv_country_idx ON country_stats_mv (country);
