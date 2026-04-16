-- GIN trigram indexes for ILIKE '%search%' patterns on github_user.
-- Without these, any contains-search causes a full seq scan on 4.3M rows (~6s).
-- With these, ILIKE '%foo%' uses the GIN index (~50ms).
--
-- Run once per DB instance (local Docker + Neon prod).
-- CONCURRENTLY = no table lock, safe on production.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS github_user_login_trgm_idx
  ON github_user USING gin (login gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS github_user_name_trgm_idx
  ON github_user USING gin (name gin_trgm_ops);
