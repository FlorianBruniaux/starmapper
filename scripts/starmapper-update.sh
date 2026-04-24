#!/usr/bin/env bash
# starmapper-update.sh — run all backfill scripts sequentially
#
# Usage:
#   pnpm update:prod             # all backfills against Neon prod
#   pnpm update:prod:force       # force re-compute even for already-filled rows
#   pnpm update:prod:dry         # dry-run (preview only, no writes)
#   pnpm update:local            # backfills against local Docker DB
#   pnpm update:local:force      # same + --force

set +e  # continue on individual step failure

FORCE=0
DRY=0
LOCAL=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --dry)   DRY=1 ;;
    --local) LOCAL=1 ;;
  esac
done

PASSED=0
FAILED=0

# ── helpers ──────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m' "$*"; }
green() { printf '\033[1;32m%s\033[0m' "$*"; }
red()   { printf '\033[1;31m%s\033[0m' "$*"; }
blue()  { printf '\033[1;34m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }

step() {
  printf '\n'
  blue "━━━ $1 ━━━"
  printf '\n'
}

run() {
  local label="$1"
  local cmd="$2"
  dim "  $ $cmd"
  printf '\n'
  if eval "$cmd"; then
    green "  ✓ $label"
    printf '\n'
    PASSED=$((PASSED + 1))
  else
    red "  ✗ $label — failed, continuing"
    printf '\n'
    FAILED=$((FAILED + 1))
  fi
}

# ── header ────────────────────────────────────────────────────────────────────

printf '\n'
bold "StarMapper Update"
[ $LOCAL -eq 1 ] && printf ' \033[33m(local)\033[0m'
[ $FORCE -eq 1 ] && printf ' \033[31m(--force)\033[0m'
[ $DRY   -eq 1 ] && printf ' \033[36m(--dry)\033[0m'
printf '\n'

# ── steps ─────────────────────────────────────────────────────────────────────

if [ $LOCAL -eq 1 ]; then

  step "1/2  Repo metrics / organic score  (local)"
  if [ $FORCE -eq 1 ]; then
    run "repo-metrics" "pnpm backfill:repo-metrics:local:force"
  else
    run "repo-metrics" "pnpm backfill:repo-metrics:local"
  fi

  step "2/2  Repo languages  (local)"
  run "repo-languages" "pnpm backfill:repo-languages"

else

  step "1/4  Repo languages  (prod)"
  if [ $DRY -eq 1 ]; then
    run "repo-languages" "pnpm backfill:repo-languages:dry"
  else
    run "repo-languages" "pnpm backfill:repo-languages:prod"
  fi

  step "2/4  Repo metrics / organic score  (prod)"
  if [ $DRY -eq 1 ]; then
    run "repo-metrics" "pnpm backfill:repo-metrics:prod:dry"
  elif [ $FORCE -eq 1 ]; then
    run "repo-metrics" "pnpm backfill:repo-metrics:prod:force"
  else
    run "repo-metrics" "pnpm backfill:repo-metrics:prod"
  fi

  step "3/4  LinkedIn URLs  (prod)"
  if [ $DRY -eq 1 ]; then
    run "linkedin" "pnpm backfill:linkedin:dry"
  else
    run "linkedin" "pnpm backfill:linkedin:prod"
  fi

  step "4/4  User languages  (prod)"
  if [ $DRY -eq 1 ]; then
    run "user-languages" "pnpm backfill:languages:dry"
  else
    run "user-languages" "pnpm backfill:languages:prod"
  fi

fi

# ── summary ───────────────────────────────────────────────────────────────────

printf '\n'
bold "━━━ Done: "
green "$PASSED passed"
printf ', '
[ $FAILED -gt 0 ] && red "$FAILED failed" || dim "0 failed"
bold " ━━━"
printf '\n\n'

[ $FAILED -eq 0 ]
