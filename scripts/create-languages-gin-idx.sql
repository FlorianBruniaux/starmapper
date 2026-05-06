-- GIN index for languages[] array containment queries (@>)
-- Used by /api/devs?language=X and /api/devs/atlas
-- Without this: full seq scan on 4M rows (~3.3s). With it: ~50ms.
SET statement_timeout = 0;
CREATE INDEX IF NOT EXISTS github_user_languages_gin_idx ON github_user USING gin (languages);
