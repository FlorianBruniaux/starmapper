-- Extended statistics for star_event(owner, repo)
--
-- Root cause of timeouts/500s on /api/stats, /api/mcp/influential and
-- /api/mcp/organic-score for large repos: Postgres' default per-column stats
-- underestimate how many star_event rows match a popular (owner, repo) pair
-- (observed: 13 estimated vs 58403 actual for vercel/next.js), so the planner
-- picks a nested-loop-per-stargazer join instead of starting from the far more
-- selective github_user.followers index. This forces a correct row-count
-- estimate without any query rewrite.
--
-- Verified locally: query time for the influential top-followers query on
-- vercel/next.js dropped from ~1073ms to ~34ms after running this + ANALYZE.
--
-- 2026-07-23 update: the (ndistinct, dependencies) statistics object above
-- was already live on Neon prod, but two gaps remained and both contributed
-- to the /api/stats timeouts documented in research-stats-timeouts.md:
--
--   1. No MCV (most-common-values) list on the extended statistics object.
--      Per-column MCV alone caps at 100 entries (the default statistics
--      target), covering only the top 100 owners/repos. Any repo outside
--      that top 100 falls back to a generic n_distinct estimate, off by up
--      to 6.5x on a measured case (rtk-ai/rtk: planner estimated 9318 rows,
--      actual 60418).
--   2. star_event.owner/repo never had their per-column statistics target
--      raised above the default (100). Measured on Neon prod 2026-07-23:
--      2624 distinct repos, 1621 distinct owners (over 26x the default MCV
--      capacity), growing steadily via `make auto-index`.
--
-- The statistics object is dropped and recreated (adding "mcv" to the
-- existing "ndistinct, dependencies" kinds) instead of creating a second,
-- differently-named object: a single object avoids a redundant ndistinct
-- computation on every ANALYZE and keeps one name to reason about.
--
-- CREATE STATISTICS does not lock the table; ALTER COLUMN ... SET STATISTICS
-- and ANALYZE only take a brief lock. No CONCURRENTLY concern here (that
-- restriction is index-specific).
--
-- Everything runs in one explicit transaction, and that is not cosmetic. Under
-- `psql -f` autocommit is on, so without BEGIN/COMMIT the DROP would commit on
-- its own and leave star_event with NO extended statistics at all until the
-- ANALYZE finishes. A concurrent /api/stats request planned during that window
-- would fall straight back into the timeout this script exists to fix, and the
-- window is not short: ANALYZE with a target of 3000 samples 900 000 rows.
-- ANALYZE is transaction-safe (unlike VACUUM), so wrapping it is legal, and
-- MVCC then gives concurrent sessions either the full old state or the full new
-- one, never the gap. The lock taken is ShareUpdateExclusive, which does not
-- block reads or writes.

SET statement_timeout = 0;

BEGIN;

-- 3000 covers today's 2624 distinct repos with headroom for growth before
-- this script needs to be re-run with a higher value.
ALTER TABLE star_event ALTER COLUMN owner SET STATISTICS 3000;
ALTER TABLE star_event ALTER COLUMN repo  SET STATISTICS 3000;

DROP STATISTICS IF EXISTS star_event_owner_repo_stat;
CREATE STATISTICS star_event_owner_repo_stat (ndistinct, dependencies, mcv)
  ON owner, repo FROM star_event;

ANALYZE star_event;

COMMIT;
