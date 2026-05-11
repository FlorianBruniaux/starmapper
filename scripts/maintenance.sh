#!/usr/bin/env bash
# maintenance.sh
#
# Full maintenance pipeline: local backfills → sync to Neon prod → refresh materialized views.
#
# Usage:
#   bash scripts/maintenance.sh              # full pipeline
#   bash scripts/maintenance.sh --dry-run    # preview only, no writes, no sync
#   bash scripts/maintenance.sh --skip-sync  # backfills only, skip sync + MV refresh
#   bash scripts/maintenance.sh --skip-backfills  # sync + MV refresh only

set -euo pipefail

# ─── Load .env.local ──────────────────────────────────────────────────────────

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
else
  echo "[error] .env.local not found — run from project root" >&2
  exit 1
fi

# ─── Args ─────────────────────────────────────────────────────────────────────

DRY_RUN=false
SKIP_SYNC=false
SKIP_BACKFILLS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --skip-sync)      SKIP_SYNC=true ;;
    --skip-backfills) SKIP_BACKFILLS=true ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────

step() { echo; echo "━━━ $1 ━━━"; }
ok()   { echo "✓ $1"; }

DRYARG=""
$DRY_RUN && DRYARG="--dry-run"

# ─── Pipeline ─────────────────────────────────────────────────────────────────

echo
echo "StarMapper maintenance — $(date '+%Y-%m-%d %H:%M')"
$DRY_RUN        && echo "  mode: DRY RUN (no writes)"
$SKIP_SYNC      && echo "  mode: --skip-sync"
$SKIP_BACKFILLS && echo "  mode: --skip-backfills"

if ! $SKIP_BACKFILLS; then

  step "1/5 — Repo metrics (stars, forks, watchers, release)"
  pnpm backfill:repo-metrics --force $DRYARG
  ok "repo metrics done"

  step "2/5 — Repo languages"
  pnpm backfill:repo-languages $DRYARG
  ok "repo languages done"

  step "3/5 — Organic scores"
  pnpm backfill:organic-score -- --force $DRYARG
  ok "organic scores done"

  step "4/5 — Developer top repos (followers ≥ 100)"
  pnpm backfill:user-top-repos -- --force $DRYARG
  ok "user top repos done"

  step "5/5 — Developer languages"
  pnpm backfill:languages -- --force $DRYARG
  ok "dev languages done"

fi

if ! $SKIP_SYNC && ! $DRY_RUN; then

  step "Sync local → Neon prod"
  bash scripts/db-sync-to-neon.sh "$DATABASE_URL"
  ok "sync done"

  step "Refresh materialized views (prod)"
  psql "$DATABASE_URL" -c "SET statement_timeout = 0;
    REFRESH MATERIALIZED VIEW CONCURRENTLY country_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY power_users_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY company_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_repo_count_mv;"
  ok "materialized views refreshed"

elif $DRY_RUN; then
  echo
  echo "Dry run complete — sync + MV refresh skipped."
fi

echo
echo "Done — $(date '+%Y-%m-%d %H:%M')"
