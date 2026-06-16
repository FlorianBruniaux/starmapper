#!/usr/bin/env bash
# db-sync-to-neon.sh
#
# Syncs local batch-scanned data to Neon production DB.
# Tables synced: github_user, star_event, badge_cache, stargazer_cache, news, api_key
# NOT synced: geocache (already in prod with 51k entries — do not overwrite)
#
# Usage:
#   NEON_URL="postgresql://..." ./scripts/db/db-sync-to-neon.sh
#
#   Or pass as argument:
#   ./scripts/db/db-sync-to-neon.sh "postgresql://..."
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

# github_user column list — single source of truth shared by the local export AND
# the Neon \copy. Both MUST use the same order: \copy ... CSV HEADER imports
# POSITIONALLY (HEADER only skips the first line, it does not match by name), so a
# drift between the export order and the staging table's physical order silently
# shifts columns. The crash "invalid input syntax for type timestamp" on
# topReposFetchedAt was exactly that: source ("stargazer") landing in a timestamp
# column. Keeping one list for export + import makes the two sides impossible to drift.
GH_COLS='login,name,company,location,followers,lat,lng,"fetchedAt","accountCreatedAt","dataVersion",following,"publicRepos","linkedinUrl","cityNormalized","countryNormalized",languages,"languagesFetchedAt","topRepos","topReposFetchedAt",source'

# ── Helper: retry a psql call on transient failure ────────────────────────────
# The live prod app writes github_user / star_event concurrently
# (bulkInsertUsersMinimal, bulkUpsertStarEvents), so a bulk upsert here can hit
# "deadlock detected". Postgres aborts one side; since every import is idempotent
# (ON CONFLICT), simply re-running wins. Also covers dropped connections.
psql_retry() {
  local attempt=1 max=4
  while true; do
    if psql "$@"; then return 0; fi
    if [[ "$attempt" -ge "$max" ]]; then
      echo "  ✗ psql failed after $max attempts" >&2
      return 1
    fi
    echo "  ↻ retry $attempt/$max after failure (deadlock?), waiting ${attempt}s..." >&2
    sleep "$attempt"
    attempt=$((attempt + 1))
  done
}

# ── Helper: sync one table ────────────────────────────────────────────────────
sync_table() {
  local TABLE="$1"
  local ON_CONFLICT="$2"

  echo "[$TABLE]"

  # Export from local — explicit column list for github_user to be immune to schema drift
  if [[ "$TABLE" == "github_user" ]]; then
    psql -v ON_ERROR_STOP=1 "$LOCAL_URL" -c "\copy (SELECT $GH_COLS FROM github_user) TO '$TMPDIR/$TABLE.csv' CSV HEADER"
  else
    psql -v ON_ERROR_STOP=1 "$LOCAL_URL" -c "\copy $TABLE TO '$TMPDIR/$TABLE.csv' CSV HEADER"
  fi
  local ROWS
  ROWS=$(( $(wc -l < "$TMPDIR/$TABLE.csv") - 1 ))
  echo "  exported $ROWS rows"

  if [[ "$ROWS" -eq 0 ]]; then
    echo "  (empty — skipping)"
    return
  fi

  # Build import script (psql file — \copy metacommand can't be in heredoc SQL)
  # _sync created WITHOUT constraints (AS SELECT ... LIMIT 0) so \copy never fails
  # on NOT NULL / CHECK violations in transit data.
  cat > "$TMPDIR/import_$TABLE.sql" <<EOF
SET statement_timeout = 0;
DROP TABLE IF EXISTS _sync;
CREATE TABLE _sync AS SELECT * FROM $TABLE LIMIT 0;
EOF
  # github_user: import by explicit column list so CSV columns map by NAME, not by
  # the staging table's physical order (CSV HEADER does not match by name).
  if [[ "$TABLE" == "github_user" ]]; then
    echo "\copy _sync ($GH_COLS) FROM '$TMPDIR/$TABLE.csv' CSV HEADER" >> "$TMPDIR/import_$TABLE.sql"
  else
    echo "\copy _sync FROM '$TMPDIR/$TABLE.csv' CSV HEADER" >> "$TMPDIR/import_$TABLE.sql"
  fi
  # github_user: coalesce integer columns that are NOT NULL in prod but may be NULL in local
  if [[ "$TABLE" == "github_user" ]]; then
    cat >> "$TMPDIR/import_$TABLE.sql" <<EOF
UPDATE _sync SET
  followers    = COALESCE(followers, 0),
  following    = COALESCE(following, 0),
  "publicRepos"  = COALESCE("publicRepos", 0),
  "dataVersion"  = COALESCE("dataVersion", 0);
EOF
  fi
  cat >> "$TMPDIR/import_$TABLE.sql" <<EOF
INSERT INTO $TABLE SELECT * FROM _sync $ON_CONFLICT;
DROP TABLE _sync;
EOF

  # ON_ERROR_STOP=1 → a SQL error aborts psql (non-zero exit), and set -e aborts the
  # script. Without it psql -f keeps going and prints "synced OK" on a failed import,
  # which is exactly how the github_user column-misalignment crash stayed hidden.
  psql_retry -v ON_ERROR_STOP=1 "$NEON_URL" -f "$TMPDIR/import_$TABLE.sql"
  echo "  synced OK"
}

# ── star_event: chunked COPY (29.6M+ rows) ────────────────────────────────────
# A single \copy of the full table over SSL times out ("SSL SYSCALL error:
# Operation timed out"). We cannot use a createdAt watermark to ship only a delta:
# the prod app writes star_events directly (bulkUpsertStarEvents in user-cache.ts),
# so prod's max(createdAt) is driven by live traffic, and past failed syncs leave
# gaps below it — an incremental cutoff would skip rows permanently. Full COPY +
# ON CONFLICT DO NOTHING is idempotent, heals gaps, and is correct regardless of
# what prod wrote on its own. Chunking keeps each COPY (one connection) short
# enough to never hit the transfer timeout.
# id/login/owner/repo/timestamps never contain newlines → safe to split by line.
sync_star_events() {
  local CHUNK_ROWS=1000000
  echo "[star_event]"

  psql -v ON_ERROR_STOP=1 "$LOCAL_URL" -c "\copy (SELECT id,login,owner,repo,\"starredAt\",\"createdAt\" FROM star_event) TO '$TMPDIR/star_event.csv' CSV HEADER"
  local ROWS
  ROWS=$(( $(wc -l < "$TMPDIR/star_event.csv") - 1 ))
  echo "  exported $ROWS rows"
  if [[ "$ROWS" -le 0 ]]; then
    echo "  (empty — skipping)"
    return
  fi

  # Staging table WITHOUT constraints (AS SELECT ... LIMIT 0) so \copy never fails
  # on FK/PK in transit data.
  psql -v ON_ERROR_STOP=1 "$NEON_URL" -c "SET statement_timeout = 0; DROP TABLE IF EXISTS _sync_star; CREATE TABLE _sync_star AS SELECT * FROM star_event LIMIT 0;"

  # Strip the header, split the data into chunks, one COPY (one connection) each.
  tail -n +2 "$TMPDIR/star_event.csv" | split -l "$CHUNK_ROWS" - "$TMPDIR/star_event_chunk_"
  local n=0
  for chunk in "$TMPDIR"/star_event_chunk_*; do
    n=$((n + 1))
    # \copy is a psql meta-command — it cannot share a -c string with SQL like
    # "SET ...;". Pass statement_timeout via PGOPTIONS (connection level) instead.
    PGOPTIONS='-c statement_timeout=0' psql -v ON_ERROR_STOP=1 "$NEON_URL" -c "\copy _sync_star (id,login,owner,repo,\"starredAt\",\"createdAt\") FROM '$chunk' CSV"
    echo "  copied chunk $n ($(wc -l < "$chunk") rows)"
  done

  # Merge into prod. The naive "INSERT ... ON CONFLICT (login,owner,repo) DO NOTHING"
  # probes the unique index ONCE PER ROW: 29.7M random index lookups on a 12GB table.
  # On Neon's remote pages each cache miss is a network round-trip → the INSERT ran
  # 1.5h+ stuck on Neon/PS_ReadIO. Fix:
  #   1. NOT EXISTS anti-join cuts the 29.7M down to only the genuinely-new rows
  #      (~6M) with a single sequential, prefetchable pass over star_event instead
  #      of 29.7M random seeks. ON CONFLICT stays as a cheap safety net: the live
  #      app (bulkUpsertStarEvents) can insert a matching key during our run, so the
  #      anti-join alone would risk a unique violation that aborts the whole INSERT.
  #   2. ANALYZE _sync_star first: CREATE TABLE AS ... LIMIT 0 + COPY leaves zero
  #      stats, so the planner sizes the joins blind and can pick a nested loop.
  #   3. work_mem bump keeps the hash anti-join in memory (tune down if Neon OOMs).
  # Omit id: prod assigns its own via the serial sequence (the local id collides
  # with rows the live app created under the same id, star_event_pkey).
  psql_retry -v ON_ERROR_STOP=1 "$NEON_URL" -c "SET statement_timeout = 0;
    SET work_mem = '512MB';
    ANALYZE _sync_star;
    INSERT INTO star_event (login, owner, repo, \"starredAt\", \"createdAt\")
    SELECT s.login, s.owner, s.repo, s.\"starredAt\", s.\"createdAt\"
    FROM _sync_star s
    WHERE EXISTS (SELECT 1 FROM github_user g WHERE g.login = s.login)
      AND NOT EXISTS (
        SELECT 1 FROM star_event e
        WHERE e.login = s.login AND e.owner = s.owner AND e.repo = s.repo
      )
    ON CONFLICT (login, owner, repo) DO NOTHING;
    DROP TABLE _sync_star;"
  echo "  synced OK ($ROWS rows staged, anti-join + conflict guard)"
}

# ── Sync order respects FK constraints (github_user before star_event) ────────
# badge_cache + stargazer_cache have no FK deps → run in parallel
# star_event references github_user → must run after github_user completes

# SKIP_HEAVY=1 skips the two expensive tables (github_user upsert of ~7M rows,
# star_event anti-join merge over 12GB). Use it to RESUME a sync that died after
# those completed but before the tail tables + MV refresh ran.
if [[ "${SKIP_HEAVY:-0}" == "1" ]]; then
  echo "[github_user] skipped (SKIP_HEAVY=1)"
else
sync_table "github_user" 'ON CONFLICT (login) DO UPDATE SET
  name=EXCLUDED.name, company=EXCLUDED.company, location=EXCLUDED.location,
  followers=EXCLUDED.followers, following=EXCLUDED.following,
  "publicRepos"=EXCLUDED."publicRepos", lat=EXCLUDED.lat, lng=EXCLUDED.lng,
  "cityNormalized"=COALESCE(EXCLUDED."cityNormalized", github_user."cityNormalized"),
  "countryNormalized"=COALESCE(EXCLUDED."countryNormalized", github_user."countryNormalized"),
  "linkedinUrl"=COALESCE(EXCLUDED."linkedinUrl", github_user."linkedinUrl"),
  languages=COALESCE(EXCLUDED.languages, github_user.languages),
  "languagesFetchedAt"=COALESCE(EXCLUDED."languagesFetchedAt", github_user."languagesFetchedAt"),
  "topRepos"=COALESCE(EXCLUDED."topRepos", github_user."topRepos"),
  "topReposFetchedAt"=COALESCE(EXCLUDED."topReposFetchedAt", github_user."topReposFetchedAt"),
  source=EXCLUDED.source,
  "fetchedAt"=EXCLUDED."fetchedAt"'
fi

sync_table "badge_cache"     'ON CONFLICT (owner, repo) DO UPDATE SET
  "mappedCount"=EXCLUDED."mappedCount",
  "countryCount"=EXCLUDED."countryCount",
  "totalCount"=EXCLUDED."totalCount",
  language=COALESCE(EXCLUDED.language, badge_cache.language),
  "forksCount"=COALESCE(EXCLUDED."forksCount", badge_cache."forksCount"),
  "watchersCount"=COALESCE(EXCLUDED."watchersCount", badge_cache."watchersCount"),
  "organicScore"=COALESCE(EXCLUDED."organicScore", badge_cache."organicScore"),
  "organicTier"=COALESCE(EXCLUDED."organicTier", badge_cache."organicTier"),
  "organicComputedAt"=COALESCE(EXCLUDED."organicComputedAt", badge_cache."organicComputedAt"),
  "openIssuesCount"=COALESCE(EXCLUDED."openIssuesCount", badge_cache."openIssuesCount"),
  "openPRsCount"=COALESCE(EXCLUDED."openPRsCount", badge_cache."openPRsCount"),
  "latestReleaseTag"=COALESCE(EXCLUDED."latestReleaseTag", badge_cache."latestReleaseTag"),
  "latestReleaseUrl"=COALESCE(EXCLUDED."latestReleaseUrl", badge_cache."latestReleaseUrl"),
  "latestReleaseAt"=COALESCE(EXCLUDED."latestReleaseAt", badge_cache."latestReleaseAt"),
  "releasesCount"=COALESCE(EXCLUDED."releasesCount", badge_cache."releasesCount"),
  "contributorsCount"=COALESCE(EXCLUDED."contributorsCount", badge_cache."contributorsCount"),
  "updatedAt"=EXCLUDED."updatedAt"
  WHERE EXCLUDED."updatedAt" > badge_cache."updatedAt"' &
PID_BADGE=$!
sync_table "stargazer_cache" 'ON CONFLICT (owner, repo) DO UPDATE SET points=EXCLUDED.points, unmapped=EXCLUDED.unmapped, "totalCount"=EXCLUDED."totalCount", "scannedAt"=EXCLUDED."scannedAt" WHERE EXCLUDED."scannedAt" > stargazer_cache."scannedAt"' &
PID_STARGAZER=$!
# wait per-PID (not bare `wait`, which always returns 0): under set -e a failed
# parallel sync now aborts the script instead of being swallowed.
wait "$PID_BADGE"
wait "$PID_STARGAZER"

if [[ "${SKIP_HEAVY:-0}" == "1" ]]; then
  echo "[star_event] skipped (SKIP_HEAVY=1)"
else
  sync_star_events
fi

# news after github_user (FK constraint)
sync_table "news" 'WHERE "authorLogin" IN (SELECT login FROM github_user) ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body, url=EXCLUDED.url, "deletedAt"=EXCLUDED."deletedAt"'

# api_key — no FK deps
sync_table "api_key" 'ON CONFLICT (key) DO UPDATE SET "lastUsedAt"=EXCLUDED."lastUsedAt", "revokedAt"=EXCLUDED."revokedAt"'

# follower_cache — no FK deps
sync_table "follower_cache" 'ON CONFLICT (login) DO UPDATE SET
  "pointsGz"=EXCLUDED."pointsGz", "unmappedGz"=EXCLUDED."unmappedGz",
  "totalCount"=EXCLUDED."totalCount", "scannedAt"=EXCLUDED."scannedAt",
  "expiresAt"=EXCLUDED."expiresAt"
  WHERE EXCLUDED."scannedAt" > follower_cache."scannedAt"'

# dependents_cache — no FK deps
sync_table "dependents_cache" 'ON CONFLICT (owner, repo) DO UPDATE SET
  "dataGz"=EXCLUDED."dataGz", "totalCount"=EXCLUDED."totalCount",
  "fetchedAt"=EXCLUDED."fetchedAt", "expiresAt"=EXCLUDED."expiresAt"
  WHERE EXCLUDED."fetchedAt" > dependents_cache."fetchedAt"'

echo ""
echo "Creating/refreshing materialized views on Neon..."
psql -v ON_ERROR_STOP=1 "$NEON_URL" <<'EOSQL'
-- country_language_stats_mv (Language Atlas)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'country_language_stats_mv') THEN
    EXECUTE $q$
      CREATE MATERIALIZED VIEW country_language_stats_mv AS
        SELECT "countryNormalized" AS country, lang, COUNT(*)::int AS cnt
        FROM github_user, unnest(languages) AS lang
        WHERE "countryNormalized" IS NOT NULL
          AND "countryNormalized" NOT LIKE 'http%'
          AND languages IS NOT NULL
          AND lat IS NOT NULL
        GROUP BY "countryNormalized", lang;
      CREATE UNIQUE INDEX country_language_stats_mv_pk_idx ON country_language_stats_mv (country, lang);
      CREATE INDEX country_language_stats_mv_lang_idx ON country_language_stats_mv (lang);
    $q$;
    RAISE NOTICE 'country_language_stats_mv created';
  ELSE
    REFRESH MATERIALIZED VIEW CONCURRENTLY country_language_stats_mv;
    RAISE NOTICE 'country_language_stats_mv refreshed';
  END IF;
END $$;
EOSQL
echo ""
echo "Sync complete."
echo ""
echo "Verify:"
echo "  psql \"\$NEON_URL\" -c \"SELECT count(*) FROM badge_cache\""
echo "  psql \"\$NEON_URL\" -c \"SELECT owner, repo, total_count FROM badge_cache ORDER BY total_count DESC LIMIT 10\""
