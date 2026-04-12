-- Language grid materialized view
-- Pre-computes lat/lng grid cells per language for /devs/[language] map endpoint.
-- Replaces the expensive GROUP BY + array_agg on 4.4M github_user rows.
--
-- Usage:
--   pnpm create:language-grid-mv:prod
--
-- Refresh:
--   pnpm refresh:language-grid-mv:prod
--   (also wired into /api/admin/refresh-grid-mv cron — runs daily at 03:00 UTC)

CREATE MATERIALIZED VIEW IF NOT EXISTS language_grid_mv AS
  SELECT
    lang,
    ROUND(lat::numeric, 1)::float                              AS lat,
    ROUND(lng::numeric, 1)::float                              AS lng,
    COUNT(*)::int                                              AS cnt,
    (array_agg(login ORDER BY followers DESC NULLS LAST))[1]  AS top_login
  FROM github_user, unnest(languages) AS lang
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND languages IS NOT NULL
  GROUP BY lang, ROUND(lat::numeric, 1), ROUND(lng::numeric, 1);

-- UNIQUE index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS language_grid_mv_pk_idx
  ON language_grid_mv (lang, lat, lng);

-- Index for fast lang lookup (primary query pattern)
CREATE INDEX IF NOT EXISTS language_grid_mv_lang_idx
  ON language_grid_mv (lang);
