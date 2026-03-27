#!/usr/bin/env bash
# db-sync-to-neon.sh
#
# Syncs local batch-scanned data to Neon production DB.
# Tables synced: github_user, star_event, badge_cache, stargazer_cache
# NOT synced: geocache (already in prod with 51k entries — do not overwrite)
#
# Usage:
#   NEON_URL="postgresql://..." ./scripts/db-sync-to-neon.sh
#
#   Or pass as argument:
#   ./scripts/db-sync-to-neon.sh "postgresql://..."
#
# Requires: psql, pg_dump (brew install postgresql)

set -euo pipefail

LOCAL_URL="postgresql://starmapper:starmapper@localhost:5433/starmapper"
NEON_URL="${1:-${NEON_URL:-}}"

if [[ -z "$NEON_URL" ]]; then
  echo "Error: Neon URL required."
  echo "  Set NEON_URL env var or pass as argument:"
  echo "  ./scripts/db-sync-to-neon.sh \"postgresql://...\""
  echo ""
  echo "  Get it from .env.local:"
  echo "    NEON_URL=\$(grep DATABASE_URL .env.local | cut -d= -f2-)"
  exit 1
fi

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "Syncing local -> Neon"
echo "  Local: $LOCAL_URL"
echo "  Neon:  ${NEON_URL:0:50}..."
echo ""

# ── Helper: sync one table ────────────────────────────────────────────────────
sync_table() {
  local TABLE="$1"
  local ON_CONFLICT="$2"

  echo "[$TABLE]"

  # Export from local
  psql "$LOCAL_URL" -c "\copy $TABLE TO '$TMPDIR/$TABLE.csv' CSV HEADER" >/dev/null 2>&1
  local ROWS
  ROWS=$(( $(wc -l < "$TMPDIR/$TABLE.csv") - 1 ))
  echo "  exported $ROWS rows"

  if [[ "$ROWS" -eq 0 ]]; then
    echo "  (empty — skipping)"
    return
  fi

  # Build import script (psql file — \copy metacommand can't be in heredoc SQL)
  cat > "$TMPDIR/import_$TABLE.sql" <<EOF
CREATE TABLE IF NOT EXISTS _sync (LIKE $TABLE INCLUDING ALL);
TRUNCATE _sync;
EOF
  echo "\copy _sync FROM '$TMPDIR/$TABLE.csv' CSV HEADER" >> "$TMPDIR/import_$TABLE.sql"
  cat >> "$TMPDIR/import_$TABLE.sql" <<EOF
INSERT INTO $TABLE SELECT * FROM _sync $ON_CONFLICT;
DROP TABLE _sync;
EOF

  psql "$NEON_URL" -f "$TMPDIR/import_$TABLE.sql" >/dev/null 2>&1
  echo "  synced OK"
}

# ── Sync order respects FK constraints (github_user before star_event) ────────

sync_table "github_user"      "ON CONFLICT (login) DO NOTHING"
sync_table "star_event"       "ON CONFLICT (login, owner, repo) DO NOTHING"
sync_table "badge_cache"      "ON CONFLICT (owner, repo) DO UPDATE SET mapped_count=EXCLUDED.mapped_count, country_count=EXCLUDED.country_count, total_count=EXCLUDED.total_count, updated_at=EXCLUDED.updated_at"
sync_table "stargazer_cache"  "ON CONFLICT (owner, repo) DO UPDATE SET points=EXCLUDED.points, unmapped=EXCLUDED.unmapped, total_count=EXCLUDED.total_count, scanned_at=EXCLUDED.scanned_at"

echo ""
echo "Sync complete."
echo ""
echo "Verify:"
echo "  psql \"\$NEON_URL\" -c \"SELECT count(*) FROM badge_cache\""
echo "  psql \"\$NEON_URL\" -c \"SELECT owner, repo, total_count FROM badge_cache ORDER BY total_count DESC LIMIT 10\""
