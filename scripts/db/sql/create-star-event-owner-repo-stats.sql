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
-- CREATE STATISTICS does not lock the table; ANALYZE only takes a brief
-- lock. No CONCURRENTLY concern here (that restriction is index-specific).

SET statement_timeout = 0;

CREATE STATISTICS IF NOT EXISTS star_event_owner_repo_stat (ndistinct, dependencies)
  ON owner, repo FROM star_event;

ANALYZE star_event;
