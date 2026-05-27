-- GIN trigram indexes for ILIKE '%search%' patterns on github_user.
-- Without these, any contains-search causes a full seq scan on 4.3M rows (~6s).
-- With these, ILIKE '%foo%' uses the GIN index (~50ms).
--
-- Run once per DB instance (local Docker + Neon prod).
-- NOTE: CONCURRENTLY is incompatible with Neon storage (causes SMGR panic).
-- Regular CREATE INDEX holds a write lock during build (~2-5min on 4.3M rows).

SET statement_timeout = 0;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS github_user_login_trgm_idx
  ON github_user USING gin (login gin_trgm_ops);

CREATE INDEX IF NOT EXISTS github_user_name_trgm_idx
  ON github_user USING gin (name gin_trgm_ops);
