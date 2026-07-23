-- repo_stats_mv, repo_location_stats_mv, repo_company_stats_mv, repo_power_users_mv
--
-- Neon prod caps statement_timeout at 10s. The four aggregates behind
-- GET /api/stats/[owner]/[repo] join star_event (33M rows) with github_user (7.2M rows),
-- filtered on a single (owner, repo). On repos above about 60 000 stars, that filtered
-- join times out systematically: 30 occurrences of [stats/totals timeout] were logged on
-- a 2h prod window (2026-07-23), because Postgres picks a nested loop with one random
-- probe into github_user per matched star_event row. 361 334 such probes on
-- developer-roadmap never fit in 10s, regardless of the plan chosen. A full unfiltered
-- scan of the same 33M rows, by contrast, runs as a single parallel hash join with no
-- random probes: measured at 59 614 ms in prod on 2026-07-23 (EXPLAIN ANALYZE,
-- statement_timeout = 0). Precomputing one row per (owner, repo) trades that one-time
-- cost, paid on a cron, for an index scan of a few milliseconds on every request, flat
-- across repo size.
--
-- repo_power_users_mv reuses the fix already applied to the live power-users query
-- (route.ts:188-197): star_event joined straight to power_users_mv lets the planner pick
-- its own parallel hash join, instead of the plan that scans power_users_mv (3.6M rows)
-- in cnt-desc order and probes star_event per row (research-stats-timeouts.md,
-- "Timeout #2").
--
-- Location and company stay on the raw string column, not countryNormalized: a 2%
-- TABLESAMPLE of github_user showed 45 823 rows with location set against 17 010 with
-- countryNormalized set, so going through the normalized column would drop about 63% of
-- the geographic signal. parseLocation() in src/lib/location-parser.ts keeps doing that
-- work client-side, unchanged.
--
-- Bounds (200 locations, 50 companies, 20 power users) match the LIMIT already applied
-- by the live route (route.ts:166, 176, 197) exactly, enforced here with
-- ROW_NUMBER() PARTITION BY (owner, repo). No behavior change, only a bounded storage
-- cost: about 494 000 rows total, 85 MB with indexes, against 13 GB for star_event alone.
--
-- Validated against Neon prod (2026-07-23): each SELECT below, restricted to one
-- (owner, repo), was run with statement_timeout = 0 and compared row for row against the
-- live route queries on three repos of very different size (emilkowalski/sonner,
-- 12 386 star_event rows; rtk-ai/rtk, 60 418; kamranahmedse/developer-roadmap, 103 232).
-- totals, mapped, avg_followers, enriched and bots matched exactly on all three, and so
-- did the top 10 of each ranked list. Full-table row counts also confirmed: 2 642 /
-- 343 775 / 100 599 / 47 025, matching the ADR's own figures within a few repos (the
-- population keeps growing between measurements taken hours apart, not a filter error).
--
-- ORDER BY cnt DESC, <value> ASC (not just cnt DESC) in the three ranked views: without
-- the tie-break, two locations/companies/logins at equal count settle their order
-- arbitrarily, so the set retained across a tie at the 200/50/20 boundary can change from
-- one REFRESH to the next with no underlying data change. REFRESH CONCURRENTLY diffs
-- whole rows, so that non-determinism would show up as phantom inserts and deletes on
-- every cycle. Confirmed harmless to the retained values themselves: re-running the
-- validation above with the tie-break added produced the same top 10 per repo, ties
-- resolved alphabetically instead of arbitrarily.
--
-- computed_at sits on repo_stats_mv only, for the same reason: its value changes on every
-- REFRESH, so every row counts as modified. Harmless across 2 642 rows, wasteful across
-- the 343 775 of repo_location_stats_mv.
--
-- repo_power_users_mv depends on power_users_mv: refresh it after, never before.
--
-- Run once per DB instance. Idempotent: safe to run multiple times (IF NOT EXISTS
-- everywhere). Never CREATE INDEX CONCURRENTLY here: Neon storage panics on it
-- (NEON_SMGR page evicted with zero LSN).

SET statement_timeout = 0;

-- Everything runs in one explicit transaction, and that is not cosmetic. Under `psql -f`
-- autocommit is on, so without BEGIN/COMMIT each CREATE would land on its own and an
-- interruption partway through the 306s build would leave repo_stats_mv in place with the
-- dimension views absent. The read route treats that state as degraded and falls back, so
-- nothing breaks, but the four views would be silently out of step until someone noticed.
-- Only ACCESS SHARE locks are taken on star_event and github_user (the SELECTs), so
-- concurrent reads and writes are unaffected for the duration.
BEGIN;

-- ============================================================
-- 1. repo_stats_mv
-- ============================================================
-- Scalar aggregates per repo for GET /api/stats/[owner]/[repo]. Reproduces the totals
-- query at route.ts:94-103 exactly (INNER JOIN included: a star_event row with no
-- matching github_user is not counted, same as today).

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_stats_mv AS
  SELECT
    se.owner,
    se.repo,
    COUNT(*)::bigint                                                        AS total,
    COUNT(*) FILTER (WHERE u.lat IS NOT NULL AND u.lng IS NOT NULL)::bigint AS mapped,
    COALESCE(AVG(u.followers)::int, 0)                                      AS avg_followers,
    COUNT(*) FILTER (WHERE u."dataVersion" >= 1)::bigint                    AS enriched,
    COUNT(*) FILTER (
      WHERE u."dataVersion" >= 1
        AND u.followers < 5
        AND u.following < 5
        AND u."publicRepos" < 2
    )::bigint                                                               AS bots,
    NOW()                                                                   AS computed_at
  FROM star_event se
  JOIN github_user u USING (login)
  GROUP BY se.owner, se.repo;

CREATE UNIQUE INDEX IF NOT EXISTS repo_stats_mv_pk_idx
  ON repo_stats_mv (owner, repo);

-- ============================================================
-- 2. repo_location_stats_mv
-- ============================================================
-- Top 200 raw locations per repo. Bound matches route.ts:166 (LIMIT 200). Ranked with a
-- secondary sort key (location ASC) so ties at the boundary are deterministic across
-- refreshes, unlike the live route which has no such need.

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_location_stats_mv AS
  SELECT owner, repo, location, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      u.location,
      COUNT(*) AS cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY COUNT(*) DESC, u.location ASC
      ) AS rn
    FROM star_event se
    JOIN github_user u USING (login)
    WHERE u.location IS NOT NULL
    GROUP BY se.owner, se.repo, u.location
  ) t
  WHERE rn <= 200;

CREATE UNIQUE INDEX IF NOT EXISTS repo_location_stats_mv_pk_idx
  ON repo_location_stats_mv (owner, repo, location);

CREATE INDEX IF NOT EXISTS repo_location_stats_mv_cnt_idx
  ON repo_location_stats_mv (owner, repo, cnt DESC);

-- ============================================================
-- 3. repo_company_stats_mv
-- ============================================================
-- Top 50 raw companies per repo. Bound matches route.ts:176 (LIMIT 50). Same tie-break
-- reasoning as repo_location_stats_mv above.

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_company_stats_mv AS
  SELECT owner, repo, company, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      u.company,
      COUNT(*) AS cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY COUNT(*) DESC, u.company ASC
      ) AS rn
    FROM star_event se
    JOIN github_user u USING (login)
    WHERE u.company IS NOT NULL
    GROUP BY se.owner, se.repo, u.company
  ) t
  WHERE rn <= 50;

CREATE UNIQUE INDEX IF NOT EXISTS repo_company_stats_mv_pk_idx
  ON repo_company_stats_mv (owner, repo, company);

CREATE INDEX IF NOT EXISTS repo_company_stats_mv_cnt_idx
  ON repo_company_stats_mv (owner, repo, cnt DESC);

-- ============================================================
-- 4. repo_power_users_mv
-- ============================================================
-- Top 20 power users per repo. Same output columns and tie-break as the live query's
-- MATERIALIZED CTE (route.ts:189-197), but not the same plan: that query needs the CTE to
-- force join order because it filters on one (owner, repo). Unfiltered, the planner picks
-- a parallel hash join on its own. Depends on power_users_mv: refresh that one first.
--
-- name and followers are deliberately not stored: the route re-reads them by primary key
-- for at most 20 logins (route.ts:214-219), which is instant, and storing them would
-- freeze follower counts that move every day.

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_power_users_mv AS
  SELECT owner, repo, login, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      mv.login,
      mv.cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY mv.cnt DESC, mv.login ASC
      ) AS rn
    FROM star_event se
    JOIN power_users_mv mv USING (login)
  ) t
  WHERE rn <= 20;

CREATE UNIQUE INDEX IF NOT EXISTS repo_power_users_mv_pk_idx
  ON repo_power_users_mv (owner, repo, login);

CREATE INDEX IF NOT EXISTS repo_power_users_mv_cnt_idx
  ON repo_power_users_mv (owner, repo, cnt DESC);

COMMIT;
