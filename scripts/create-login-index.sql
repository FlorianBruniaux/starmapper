-- Functional index for case-insensitive profile lookup (lower(login) = lower($1))
-- Without this, Prisma mode:"insensitive" forces a full seq scan on ~4M rows.
SET statement_timeout = 0;
CREATE INDEX IF NOT EXISTS github_user_login_lower_idx ON github_user (lower(login));
