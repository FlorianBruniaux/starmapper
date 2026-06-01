-- Covering index for /api/stats/[owner]/[repo]/geo-velocity
--
-- The query JOINs star_event → github_user on login, groups by countryNormalized,
-- and runs FILTER aggregations on starredAt. Without starredAt in the index, Postgres
-- fetches the heap for every row. With this covering index it can do an index-only scan.
--
-- Must be applied with statement_timeout = 0 (Neon forbids CONCURRENTLY).
-- For a table with ~22M rows, expect ~2-5 min creation time.

SET statement_timeout = 0;

CREATE INDEX IF NOT EXISTS star_event_geo_velocity_idx
  ON star_event (owner, repo, login, "starredAt");
