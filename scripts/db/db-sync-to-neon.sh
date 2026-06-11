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

# ── Helper: sync one table ────────────────────────────────────────────────────
sync_table() {
  local TABLE="$1"
  local ON_CONFLICT="$2"

  echo "[$TABLE]"

  # Export from local — explicit column list for github_user to be immune to schema drift
  if [[ "$TABLE" == "github_user" ]]; then
    psql "$LOCAL_URL" -c "\copy (SELECT login,name,company,location,followers,lat,lng,\"fetchedAt\",\"accountCreatedAt\",\"dataVersion\",following,\"publicRepos\",\"linkedinUrl\",\"cityNormalized\",\"countryNormalized\",languages,\"languagesFetchedAt\",\"topRepos\",\"topReposFetchedAt\",source FROM github_user) TO '$TMPDIR/$TABLE.csv' CSV HEADER"
  else
    psql "$LOCAL_URL" -c "\copy $TABLE TO '$TMPDIR/$TABLE.csv' CSV HEADER"
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
  echo "\copy _sync FROM '$TMPDIR/$TABLE.csv' CSV HEADER" >> "$TMPDIR/import_$TABLE.sql"
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

  psql "$NEON_URL" -f "$TMPDIR/import_$TABLE.sql"
  echo "  synced OK"
}

# ── Sync order respects FK constraints (github_user before star_event) ────────
# badge_cache + stargazer_cache have no FK deps → run in parallel
# star_event references github_user → must run after github_user completes

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
sync_table "stargazer_cache" 'ON CONFLICT (owner, repo) DO UPDATE SET points=EXCLUDED.points, unmapped=EXCLUDED.unmapped, "totalCount"=EXCLUDED."totalCount", "scannedAt"=EXCLUDED."scannedAt" WHERE EXCLUDED."scannedAt" > stargazer_cache."scannedAt"' &
wait

sync_table "star_event" "WHERE login IN (SELECT login FROM github_user) ON CONFLICT (login, owner, repo) DO NOTHING"

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
psql "$NEON_URL" <<'EOSQL'
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
