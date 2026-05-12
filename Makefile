# StarMapper — Maintainer scripts
# Usage: make <target>  (requires .env.local to be sourced via the inline sh -c pattern)
# Contributors: use `pnpm <script>` instead — see package.json for the full list.

ENV = sh -c 'set -a && . .env.local && set +a &&

# ─── DB sync (local ↔ prod) ────────────────────────────────────────────────────

db-sync-to-prod:
	$(ENV) ./scripts/db-sync-to-neon.sh "$$DATABASE_URL"'

db-sync-from-prod:
	$(ENV) ./scripts/db-sync-from-neon.sh "$$DATABASE_URL"'

db-dump:
	$(ENV) pg_dump "$$DATABASE_URL" --no-owner --no-acl -Fc --exclude-table=geocache -f /tmp/neon-prod.dump && echo "Dump saved to /tmp/neon-prod.dump"'

db-restore:
	$(ENV) pg_restore --no-owner --no-acl -d "$$DATABASE_URL_LOCAL" --clean --if-exists /tmp/neon-prod.dump'

db-pull: db-dump db-restore
	@echo "Local DB aligned with prod."

# ─── Materialized views (idempotent — IF NOT EXISTS) ───────────────────────────

mv-country-stats:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/create-country-stats-mv.sql'

mv-country-stats-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/create-country-stats-mv.sql'

mv-country-language:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/create-country-language-mv.sql'

mv-country-language-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/create-country-language-mv.sql'

mv-user-repo-count:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/create-user-repo-count-mv.sql'

mv-user-repo-count-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/create-user-repo-count-mv.sql'

mv-trending:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/create-trending-mv.sql'

mv-trending-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/create-trending-mv.sql'

mv-language-grid:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/create-language-grid-mv.sql'

mv-language-grid-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/create-language-grid-mv.sql'

refresh-all:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -c "SET statement_timeout = 0; REFRESH MATERIALIZED VIEW country_stats_mv; REFRESH MATERIALIZED VIEW power_users_mv; REFRESH MATERIALIZED VIEW company_stats_mv; REFRESH MATERIALIZED VIEW user_repo_count_mv;"'

refresh-all-prod:
	$(ENV) psql "$$DATABASE_URL" -c "SET statement_timeout = 0; REFRESH MATERIALIZED VIEW country_stats_mv; REFRESH MATERIALIZED VIEW power_users_mv; REFRESH MATERIALIZED VIEW company_stats_mv; REFRESH MATERIALIZED VIEW user_repo_count_mv;"'

# ─── Backfills ─────────────────────────────────────────────────────────────────

backfill-languages:
	$(ENV) tsx scripts/backfill-languages.ts'

backfill-languages-prod:
	$(ENV) tsx scripts/backfill-languages.ts --prod'

backfill-linkedin:
	$(ENV) tsx scripts/backfill-linkedin.ts'

backfill-linkedin-prod:
	$(ENV) tsx scripts/backfill-linkedin.ts --prod'

backfill-repo-languages:
	$(ENV) tsx scripts/backfill-repo-languages.ts'

backfill-repo-languages-prod:
	$(ENV) tsx scripts/backfill-repo-languages.ts --prod'

backfill-repo-metrics:
	$(ENV) tsx scripts/backfill-repo-metrics.ts'

backfill-repo-metrics-prod:
	$(ENV) DATABASE_URL_LOCAL= NEXT_PUBLIC_ORGANIC_SCORE_ENABLED=true tsx scripts/backfill-repo-metrics.ts'

backfill-user-top-repos:
	$(ENV) DATABASE_DRIVER=standard DATABASE_URL=$$DATABASE_URL_LOCAL tsx scripts/backfill-user-top-repos.ts'

backfill-user-top-repos-prod:
	$(ENV) tsx scripts/backfill-user-top-repos.ts'

# ─── Collect + batch scan ──────────────────────────────────────────────────────

collect-repos:
	$(ENV) tsx scripts/collect-user-repos.ts'

collect-trending:
	$(ENV) tsx scripts/collect-trending-repos.ts'

collect-merge:
	node -e "const fs=require('fs'),g=p=>fs.existsSync(p)?require(p):[];const a=g('./scripts/repos-from-users.json'),b=g('./scripts/repos-trending.json'),m=[...new Set([...a,...b])];fs.writeFileSync('scripts/repos-all.json',JSON.stringify(m,null,2));console.log('Merged:',m.length,'repos')"

batch-scan:
	$(ENV) caffeinate -i tsx scripts/batch-scan.ts --local --input scripts/repos-all.json'

batch-scan-dry:
	$(ENV) tsx scripts/batch-scan.ts --local --input scripts/repos-all.json --dry-run'

# ─── Calibration + probes ──────────────────────────────────────────────────────

calibrate-organic-score:
	$(ENV) tsx scripts/calibrate-organic-score.ts'

probe-star-burst:
	$(ENV) tsx scripts/probe-star-burst.ts'

# ─── Maintenance (full pipeline) ──────────────────────────────────────────────

maintenance:
	bash scripts/maintenance.sh

maintenance-dry:
	bash scripts/maintenance.sh --dry-run

maintenance-sync-only:
	bash scripts/maintenance.sh --skip-backfills

# ─── Deploy helpers ────────────────────────────────────────────────────────────

update-prod:
	bash scripts/starmapper-update.sh

update-prod-dry:
	bash scripts/starmapper-update.sh --dry

update-local:
	bash scripts/starmapper-update.sh --local

.PHONY: db-sync-to-prod db-sync-from-prod db-dump db-restore db-pull \
        mv-country-stats mv-country-stats-prod mv-country-language mv-country-language-prod \
        mv-user-repo-count mv-user-repo-count-prod mv-trending mv-trending-prod \
        mv-language-grid mv-language-grid-prod refresh-all refresh-all-prod \
        backfill-languages backfill-languages-prod backfill-linkedin backfill-linkedin-prod \
        backfill-repo-languages backfill-repo-languages-prod backfill-repo-metrics backfill-repo-metrics-prod \
        backfill-user-top-repos backfill-user-top-repos-prod \
        maintenance maintenance-dry maintenance-sync-only \
        collect-repos collect-trending collect-merge batch-scan batch-scan-dry \
        calibrate-organic-score probe-star-burst \
        update-prod update-prod-dry update-local
