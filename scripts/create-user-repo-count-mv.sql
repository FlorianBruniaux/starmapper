-- user_repo_count_mv: per-user count of tracked repos (distinct owner/repo pairs).
-- Replaces the expensive LEFT JOIN star_event + COUNT(DISTINCT) in the nearby query.
-- Refresh: included in /api/admin/refresh-grid-mv (daily cron).
-- Run once per DB instance (local Docker + Neon prod).

CREATE MATERIALIZED VIEW user_repo_count_mv AS
SELECT login, COUNT(*) AS repo_count
FROM star_event
GROUP BY login;

CREATE UNIQUE INDEX user_repo_count_mv_login_idx ON user_repo_count_mv (login);
