-- backfill-latest-starred-at.sql
-- Backfills latestStarredAt on stargazer_cache rows where it is NULL.
-- Uses the max(starredAt) from star_event for each (owner, repo) pair.
-- Safe to run multiple times (idempotent WHERE clause).
--
-- Usage (local):
--   psql "postgresql://starmapper:starmapper@localhost:5433/starmapper" \
--     -f scripts/backfill-latest-starred-at.sql
--
-- Usage (prod via .env.local):
--   sh -c 'set -a && . .env.local && set +a && psql "$DATABASE_URL" \
--     -f scripts/backfill-latest-starred-at.sql'

UPDATE stargazer_cache sc
SET "latestStarredAt" = se.max_starred_at
FROM (
  SELECT owner, repo, MAX("starredAt") AS max_starred_at
  FROM star_event
  GROUP BY owner, repo
) se
WHERE sc.owner = se.owner
  AND sc.repo  = se.repo
  AND sc."latestStarredAt" IS NULL;
