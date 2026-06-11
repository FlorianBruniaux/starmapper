-- trending_repos_mv: top repos by star velocity (7/30/90-day windows).
-- Powers GET /api/trending and the /trending page.
-- Refresh: included in /api/admin/refresh-grid-mv (daily cron, 03:00 UTC).
-- Run once per DB instance (local Docker + Neon prod).
-- NOTE: CONCURRENTLY not used here (first creation) — cron uses CONCURRENTLY after.
-- Re-runnable: DROP first so the 30-day entry gate can be re-applied on an existing DB.

SET statement_timeout = 0;

-- Speed up time-window queries on 11.9M+ rows.
CREATE INDEX IF NOT EXISTS star_event_starred_at_idx ON star_event ("starredAt");

DROP MATERIALIZED VIEW IF EXISTS trending_repos_mv;

CREATE MATERIALIZED VIEW trending_repos_mv AS
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

-- Required for REFRESH CONCURRENTLY (used by daily cron).
CREATE UNIQUE INDEX trending_repos_mv_owner_repo_idx ON trending_repos_mv (owner, repo);
CREATE INDEX trending_repos_mv_stars_7d_idx ON trending_repos_mv (stars_7d DESC);
