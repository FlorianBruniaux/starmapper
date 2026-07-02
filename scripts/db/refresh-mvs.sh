#!/usr/bin/env bash
# refresh-mvs.sh — Refresh all 8 materialized views on Neon prod
#
# Uses the direct (non-pooler) connection so that SET statement_timeout = 0
# works. CONCURRENTLY avoids locking reads during refresh.
#
# Usage:
#   ./scripts/db/refresh-mvs.sh "$DATABASE_URL"

set -euo pipefail

NEON_URL="${1:-${DATABASE_URL:-}}"

if [[ -z "$NEON_URL" ]]; then
  echo "Error: DATABASE_URL is not set." >&2
  exit 1
fi

DIRECT_URL=$(python3 -c "
import re, urllib.parse, sys
u = urllib.parse.urlparse(sys.argv[1])
q = urllib.parse.parse_qs(u.query, keep_blank_values=True)
q.pop('pgbouncer', None)
q.pop('connect_timeout', None)
host = re.sub(r'-pooler(\.[^:@/]+)', r'\1', u.hostname or '')
netloc = u.netloc.replace(u.hostname or '', host)
print(urllib.parse.urlunparse(u._replace(netloc=netloc, query=urllib.parse.urlencode({k: v[0] for k, v in q.items()}))))
" "$NEON_URL")

echo "Refreshing materialized views on Neon prod..."
echo "  Endpoint: ${DIRECT_URL%%\?*}"
echo ""

psql "$DIRECT_URL" -c "
SET statement_timeout = 0;
REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY country_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY power_users_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY company_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY country_language_stats_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY user_repo_count_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY trending_repos_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY city_stats_mv;
"

echo "All MVs refreshed."
