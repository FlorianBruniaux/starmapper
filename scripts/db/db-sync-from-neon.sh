#!/usr/bin/env bash
# db-sync-from-neon.sh — Neon prod → local Docker
#
# Syncs production data to local for dev/testing.
# NOT synced: geocache (already seeded locally with 51k entries).
#
# Usage:
#   ./scripts/db-sync-from-neon.sh "$NEON_URL" [options]
#   pnpm db:sync:from-neon                          # all tables
#   pnpm db:sync:from-neon -- --limit 50000         # cap large tables at 50k rows
#   pnpm db:sync:from-neon -- --repo facebook/react # one repo only (fastest)
#   pnpm db:sync:from-neon -- --tables badge_cache,stargazer_cache
#
# Options:
#   --limit N           Limit rows for github_user + star_event (ordered by followers DESC / id DESC).
#   --tables t1,t2,...  Sync only listed tables (comma-separated).
#   --repo owner/repo   Sync only data related to one repo. Implies badge_cache + stargazer_cache
#                       + star_event + github_user (users who starred it).
#
# Requires: psql (brew install postgresql)

set -euo pipefail

LOCAL_URL="postgresql://starmapper:starmapper@localhost:5433/starmapper"
NEON_URL="${1:-${NEON_URL:-}}"

if [[ -z "$NEON_URL" ]]; then
  echo "Error: Neon URL required."
  echo "  pnpm db:sync:from-neon   (reads DATABASE_URL from .env.local)"
  echo "  ./scripts/db-sync-from-neon.sh \"postgresql://...\""
  exit 1
fi

# ── Parse options ─────────────────────────────────────────────────────────────
LIMIT=""
TABLES="github_user,star_event,badge_cache,stargazer_cache,api_key,news"
REPO=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)  LIMIT="$2";  shift 2 ;;
    --tables) TABLES="$2"; shift 2 ;;
    --repo)   REPO="$2";   shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Syncing Neon → local"
echo "  Neon:  ${NEON_URL:0:50}..."
echo "  Local: $LOCAL_URL"
[[ -n "$REPO"  ]] && echo "  Repo:  $REPO"
[[ -n "$LIMIT" ]] && echo "  Limit: $LIMIT rows on large tables"
echo ""

# ── Helper: import one table ──────────────────────────────────────────────────
import_table() {
  local TABLE="$1"
  local QUERY="$2"
  local ON_CONFLICT="$3"

  echo "[$TABLE]"
  psql "$NEON_URL" -c "SET statement_timeout = 0" -c "\copy ($QUERY) TO '$TMPDIR/$TABLE.csv' CSV HEADER"
  local ROWS
  ROWS=$(( $(wc -l < "$TMPDIR/$TABLE.csv") - 1 ))
  echo "  exported $ROWS rows from Neon"

  if [[ "$ROWS" -eq 0 ]]; then
    echo "  (empty — skipping)"
    return
  fi

  cat > "$TMPDIR/import_$TABLE.sql" <<EOF
SET statement_timeout = 0;
DROP TABLE IF EXISTS _sync;
CREATE TABLE _sync AS SELECT * FROM $TABLE LIMIT 0;
EOF
  echo "\copy _sync FROM '$TMPDIR/$TABLE.csv' CSV HEADER" >> "$TMPDIR/import_$TABLE.sql"
  cat >> "$TMPDIR/import_$TABLE.sql" <<EOF
INSERT INTO $TABLE SELECT * FROM _sync $ON_CONFLICT;
DROP TABLE _sync;
EOF

  psql "$LOCAL_URL" -f "$TMPDIR/import_$TABLE.sql"
  echo "  imported OK"
}

# ── Build queries per mode ────────────────────────────────────────────────────
has_table() { echo ",$TABLES," | grep -q ",$1,"; }

LIMIT_CLAUSE=""
[[ -n "$LIMIT" ]] && LIMIT_CLAUSE="LIMIT $LIMIT"

if [[ -n "$REPO" ]]; then
  # --repo mode: pull only what's needed for one repo
  OWNER="${REPO%%/*}"
  REPONAME="${REPO##*/}"

  has_table "github_user" && import_table "github_user" \
    "SELECT u.login,u.name,u.company,u.location,u.followers,u.following,u.\"publicRepos\",u.lat,u.lng,u.\"linkedinUrl\",u.\"cityNormalized\",u.\"countryNormalized\",u.languages,u.\"languagesFetchedAt\",u.\"accountCreatedAt\",u.\"dataVersion\",u.\"fetchedAt\"
     FROM github_user u
     WHERE u.login IN (SELECT login FROM star_event WHERE owner='$OWNER' AND repo='$REPONAME')
     ORDER BY u.followers DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (login) DO UPDATE SET
      name=EXCLUDED.name, company=EXCLUDED.company, location=EXCLUDED.location,
      followers=EXCLUDED.followers, following=EXCLUDED.following,
      "publicRepos"=EXCLUDED."publicRepos", lat=EXCLUDED.lat, lng=EXCLUDED.lng,
      "cityNormalized"=COALESCE(EXCLUDED."cityNormalized", github_user."cityNormalized"),
      "countryNormalized"=COALESCE(EXCLUDED."countryNormalized", github_user."countryNormalized"),
      "linkedinUrl"=COALESCE(EXCLUDED."linkedinUrl", github_user."linkedinUrl"),
      languages=COALESCE(EXCLUDED.languages, github_user.languages),
      "languagesFetchedAt"=COALESCE(EXCLUDED."languagesFetchedAt", github_user."languagesFetchedAt"),
      "fetchedAt"=EXCLUDED."fetchedAt"'

  has_table "star_event" && import_table "star_event" \
    "SELECT id,login,owner,repo,\"starredAt\",\"createdAt\" FROM star_event
     WHERE owner='$OWNER' AND repo='$REPONAME' ORDER BY id $LIMIT_CLAUSE" \
    'ON CONFLICT (login, owner, repo) DO NOTHING'

  has_table "badge_cache" && import_table "badge_cache" \
    "SELECT * FROM badge_cache WHERE owner='$OWNER' AND repo='$REPONAME'" \
    'ON CONFLICT (owner, repo) DO UPDATE SET
      "mappedCount"=EXCLUDED."mappedCount", "countryCount"=EXCLUDED."countryCount",
      "totalCount"=EXCLUDED."totalCount", "updatedAt"=EXCLUDED."updatedAt"'

  has_table "stargazer_cache" && import_table "stargazer_cache" \
    "SELECT * FROM stargazer_cache WHERE owner='$OWNER' AND repo='$REPONAME'" \
    'ON CONFLICT (owner, repo) DO UPDATE SET
      points=EXCLUDED.points, unmapped=EXCLUDED.unmapped,
      "totalCount"=EXCLUDED."totalCount", "scannedAt"=EXCLUDED."scannedAt"'

else
  # Full sync mode (respects FK order: github_user before star_event)
  has_table "github_user" && import_table "github_user" \
    "SELECT login,name,company,location,followers,following,\"publicRepos\",lat,lng,\"linkedinUrl\",\"cityNormalized\",\"countryNormalized\",languages,\"languagesFetchedAt\",\"accountCreatedAt\",\"dataVersion\",\"fetchedAt\"
     FROM github_user ORDER BY followers DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (login) DO UPDATE SET
      name=EXCLUDED.name, company=EXCLUDED.company, location=EXCLUDED.location,
      followers=EXCLUDED.followers, following=EXCLUDED.following,
      "publicRepos"=EXCLUDED."publicRepos", lat=EXCLUDED.lat, lng=EXCLUDED.lng,
      "cityNormalized"=COALESCE(EXCLUDED."cityNormalized", github_user."cityNormalized"),
      "countryNormalized"=COALESCE(EXCLUDED."countryNormalized", github_user."countryNormalized"),
      "linkedinUrl"=COALESCE(EXCLUDED."linkedinUrl", github_user."linkedinUrl"),
      languages=COALESCE(EXCLUDED.languages, github_user.languages),
      "languagesFetchedAt"=COALESCE(EXCLUDED."languagesFetchedAt", github_user."languagesFetchedAt"),
      "fetchedAt"=EXCLUDED."fetchedAt"'

  has_table "badge_cache" && import_table "badge_cache" \
    "SELECT * FROM badge_cache ORDER BY \"updatedAt\" DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (owner, repo) DO UPDATE SET
      "mappedCount"=EXCLUDED."mappedCount", "countryCount"=EXCLUDED."countryCount",
      "totalCount"=EXCLUDED."totalCount", "updatedAt"=EXCLUDED."updatedAt"' &

  has_table "stargazer_cache" && import_table "stargazer_cache" \
    "SELECT * FROM stargazer_cache ORDER BY \"scannedAt\" DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (owner, repo) DO UPDATE SET
      points=EXCLUDED.points, unmapped=EXCLUDED.unmapped,
      "totalCount"=EXCLUDED."totalCount", "scannedAt"=EXCLUDED."scannedAt"' &

  wait

  # star_event after github_user (FK constraint)
  has_table "star_event" && import_table "star_event" \
    "SELECT id,login,owner,repo,\"starredAt\",\"createdAt\" FROM star_event
     WHERE login IN (SELECT login FROM github_user) ORDER BY id DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (login, owner, repo) DO NOTHING'

  # news after github_user (FK: authorLogin references github_user.login)
  has_table "news" && import_table "news" \
    "SELECT id,\"authorLogin\",body,url,\"publishedAt\",\"deletedAt\" FROM news
     WHERE \"authorLogin\" IN (SELECT login FROM github_user) ORDER BY \"publishedAt\" DESC $LIMIT_CLAUSE" \
    'ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, url=EXCLUDED.url, "deletedAt"=EXCLUDED."deletedAt"'

  # api_key — no FK deps
  has_table "api_key" && import_table "api_key" \
    "SELECT key,\"keyHash\",email,name,note,\"createdAt\",\"revokedAt\",\"lastUsedAt\" FROM api_key ORDER BY \"createdAt\" DESC" \
    'ON CONFLICT (key) DO UPDATE SET "lastUsedAt"=EXCLUDED."lastUsedAt", "revokedAt"=EXCLUDED."revokedAt"'
fi

echo ""
echo "Sync complete."
echo ""
echo "Verify:"
echo "  psql \"$LOCAL_URL\" -c \"SELECT count(*) FROM github_user\""
echo "  psql \"$LOCAL_URL\" -c \"SELECT owner, repo, \\\"totalCount\\\" FROM badge_cache ORDER BY \\\"totalCount\\\" DESC LIMIT 10\""
