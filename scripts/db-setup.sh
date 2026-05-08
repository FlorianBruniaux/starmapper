#!/usr/bin/env bash
# One-shot DB setup for new contributors (local Docker) or new Neon instances.
# Run after: cp .env.example .env.local && pnpm install
set -e

DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "Error: DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
  exit 1
fi

echo "==> 1/4 Prisma db push"
pnpm exec prisma db push

echo "==> 2/4 pg_trgm extension + GIN indexes (login + name search)"
psql "$DB_URL" <<'SQL'
SET statement_timeout = 0;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS github_user_login_trgm_idx ON github_user USING gin (login gin_trgm_ops);
CREATE INDEX IF NOT EXISTS github_user_name_trgm_idx  ON github_user USING gin (name  gin_trgm_ops);
SQL

echo "==> 3/4 Materialized views"
psql "$DB_URL" <<'SQL'
SET statement_timeout = 0;

-- country_stats_mv
CREATE MATERIALIZED VIEW IF NOT EXISTS country_stats_mv AS
  SELECT "countryNormalized" AS country, COUNT(*) AS cnt
  FROM github_user
  WHERE "countryNormalized" IS NOT NULL AND "countryNormalized" NOT LIKE 'http%'
  GROUP BY "countryNormalized" ORDER BY cnt DESC;
CREATE UNIQUE INDEX IF NOT EXISTS country_stats_mv_country_idx ON country_stats_mv (country);

-- power_users_mv
CREATE MATERIALIZED VIEW IF NOT EXISTS power_users_mv AS
  SELECT login, COUNT(*) AS cnt FROM star_event
  GROUP BY login HAVING COUNT(*) > 1 ORDER BY cnt DESC, login ASC;
CREATE UNIQUE INDEX IF NOT EXISTS power_users_mv_login_idx ON power_users_mv (login);
CREATE INDEX IF NOT EXISTS power_users_mv_cnt_login_idx ON power_users_mv (cnt DESC, login ASC);

-- company_stats_mv
CREATE MATERIALIZED VIEW IF NOT EXISTS company_stats_mv AS
  SELECT company, COUNT(*) AS cnt FROM github_user
  WHERE company IS NOT NULL AND company <> ''
  GROUP BY company ORDER BY cnt DESC;
CREATE UNIQUE INDEX IF NOT EXISTS company_stats_mv_company_idx ON company_stats_mv (company);

-- user_repo_count_mv
CREATE MATERIALIZED VIEW IF NOT EXISTS user_repo_count_mv AS
  SELECT login, COUNT(*) AS repo_count FROM star_event GROUP BY login;
CREATE UNIQUE INDEX IF NOT EXISTS user_repo_count_mv_login_idx ON user_repo_count_mv (login);

-- github_user_grid_mv (heatmap)
CREATE MATERIALIZED VIEW IF NOT EXISTS github_user_grid_mv AS
  SELECT
    ROUND(lat::numeric, 1)::float AS lat,
    ROUND(lng::numeric, 1)::float AS lng,
    COUNT(*) AS cnt,
    MAX(followers) AS max_followers
  FROM github_user WHERE lat IS NOT NULL AND lng IS NOT NULL
  GROUP BY ROUND(lat::numeric,1), ROUND(lng::numeric,1);
CREATE UNIQUE INDEX IF NOT EXISTS github_user_grid_mv_lat_lng_idx ON github_user_grid_mv (lat, lng);
SQL

echo "==> 4/4 Optional: country_language_stats_mv (Language Atlas)"
echo "    Skipped on fresh DB (requires github_user.languages[] to be populated)."
echo "    Run 'pnpm create:country-language-mv' after backfilling language data."

echo ""
echo "Done. Run 'pnpm dev' to start the dev server."
