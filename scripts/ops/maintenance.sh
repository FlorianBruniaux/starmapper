#!/usr/bin/env bash
# maintenance.sh
#
# Full maintenance pipeline: local backfills → sync to Neon prod → refresh materialized views.
#
# Usage:
#   bash scripts/ops/maintenance.sh                    # full pipeline
#   bash scripts/ops/maintenance.sh --dry-run          # preview only, no writes, no sync
#   bash scripts/ops/maintenance.sh --skip-sync        # backfills only, skip sync + MV refresh
#   bash scripts/ops/maintenance.sh --skip-backfills   # sync + MV refresh only
#
# Granular skip flags (combinable):
#   --skip-repo-metrics    skip step 1/6 (stars, forks, watchers, release)
#   --skip-repo-languages  skip step 2/6 (primary language per repo)
#   --skip-organic         skip steps 3+4/6 (contributors backfill + organic score + tier)
#   --skip-top-repos       skip step 5/6 (topRepos[] for devs ≥ 100 followers)
#   --skip-languages       skip step 6/6 (languages[] from GitHub GraphQL — slowest)

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
SKIP_REPO_METRICS=false
SKIP_REPO_LANGUAGES=false
SKIP_ORGANIC=false
SKIP_TOP_REPOS=false
SKIP_LANGUAGES=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)             DRY_RUN=true ;;
    --skip-sync)           SKIP_SYNC=true ;;
    --skip-backfills)      SKIP_BACKFILLS=true ;;
    --skip-repo-metrics)   SKIP_REPO_METRICS=true ;;
    --skip-repo-languages) SKIP_REPO_LANGUAGES=true ;;
    --skip-organic)        SKIP_ORGANIC=true ;;
    --skip-top-repos)      SKIP_TOP_REPOS=true ;;
    --skip-languages|--skip-language) SKIP_LANGUAGES=true ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────

step() { echo; echo "━━━ $1 ━━━"; }
skip() { echo; echo "━━━ $1 [skipped] ━━━"; }
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

  if ! $SKIP_REPO_METRICS; then
    step "1/6 — Repo metrics (stars, forks, watchers, release)"
    pnpm backfill:repo-metrics:local -- --force $DRYARG
    ok "repo metrics done"
  else
    skip "1/6 — Repo metrics"
  fi

  if ! $SKIP_REPO_LANGUAGES; then
    step "2/6 — Repo languages"
    pnpm backfill:repo-languages:local -- $DRYARG
    ok "repo languages done"
  else
    skip "2/6 — Repo languages"
  fi

  if ! $SKIP_ORGANIC; then
    step "3/6 — Contributors / 1k stars (must run before organic recompute)"
    pnpm backfill:contributors:local -- $DRYARG
    ok "contributors done"

    step "4/6 — Organic scores (uses fresh contributors data)"
    pnpm backfill:organic-score:local -- --force $DRYARG
    ok "organic scores done"
  else
    skip "3/6 — Contributors"
    skip "4/6 — Organic scores"
  fi

  if ! $SKIP_TOP_REPOS; then
    step "5/6 — Developer top repos (followers ≥ 100)"
    pnpm backfill:user-top-repos:local -- --force $DRYARG
    ok "user top repos done"
  else
    skip "5/6 — Developer top repos"
  fi

  if ! $SKIP_LANGUAGES; then
    step "6/6 — Developer languages (new users only + refresh >30d)"
    pnpm backfill:languages:local -- --since 30 $DRYARG
    ok "dev languages done"
  else
    skip "6/6 — Developer languages"
  fi

fi

if ! $SKIP_SYNC && ! $DRY_RUN; then

  step "Sync local → Neon prod"
  bash scripts/db/db-sync-to-neon.sh "$DATABASE_URL"
  ok "sync done"

  step "Refresh materialized views (prod)"
  psql "$DATABASE_URL" -c "SET statement_timeout = 0;
    REFRESH MATERIALIZED VIEW CONCURRENTLY country_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY power_users_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY company_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY country_language_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_repo_count_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY language_grid_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY trending_repos_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY city_stats_mv;
    REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv;"
  ok "materialized views refreshed (9/9)"

elif $DRY_RUN; then
  echo
  echo "Dry run complete — sync + MV refresh skipped."
fi

echo
echo "Done — $(date '+%Y-%m-%d %H:%M')"
