# StarMapper — Maintainer scripts
# Usage: make <target>  (requires .env.local to be sourced via the inline sh -c pattern)
# Contributors: use `pnpm <script>` instead — see package.json for the full list.

ENV = sh -c 'set -a && . .env.local && set +a &&

# ─── DB sync (local ↔ prod) ────────────────────────────────────────────────────

db-sync-to-prod:
	$(ENV) ./scripts/db/db-sync-to-neon.sh "$$DATABASE_URL"'

db-sync-from-prod:
	$(ENV) ./scripts/db/db-sync-from-neon.sh "$$DATABASE_URL"'

db-dump:
	$(ENV) pg_dump "$$DATABASE_URL" --no-owner --no-acl -Fc --exclude-table=geocache -f /tmp/neon-prod.dump && echo "Dump saved to /tmp/neon-prod.dump"'

db-restore:
	$(ENV) pg_restore --no-owner --no-acl -d "$$DATABASE_URL_LOCAL" --clean --if-exists /tmp/neon-prod.dump'

db-pull: db-dump db-restore
	@echo "Local DB aligned with prod."

# ─── Materialized views (idempotent — IF NOT EXISTS) ───────────────────────────

mv-country-stats:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-country-stats-mv.sql'

mv-country-stats-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-country-stats-mv.sql'

mv-country-language:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-country-language-mv.sql'

mv-country-language-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-country-language-mv.sql'

mv-user-repo-count:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-user-repo-count-mv.sql'

mv-user-repo-count-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-user-repo-count-mv.sql'

mv-trending:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-trending-mv.sql'

mv-trending-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-trending-mv.sql'

mv-language-grid:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-language-grid-mv.sql'

mv-language-grid-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-language-grid-mv.sql'

idx-geo-velocity:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -f scripts/db/sql/create-geo-velocity-index.sql'

idx-geo-velocity-prod:
	$(ENV) psql "$$DATABASE_URL" -f scripts/db/sql/create-geo-velocity-index.sql'

refresh-all:
	$(ENV) psql "$$DATABASE_URL_LOCAL" -c "SET statement_timeout = 0; REFRESH MATERIALIZED VIEW country_stats_mv; REFRESH MATERIALIZED VIEW power_users_mv; REFRESH MATERIALIZED VIEW company_stats_mv; REFRESH MATERIALIZED VIEW user_repo_count_mv;"'

refresh-all-prod:
	$(ENV) psql "$$DATABASE_URL" -c "SET statement_timeout = 0; REFRESH MATERIALIZED VIEW country_stats_mv; REFRESH MATERIALIZED VIEW power_users_mv; REFRESH MATERIALIZED VIEW company_stats_mv; REFRESH MATERIALIZED VIEW user_repo_count_mv;"'

# ─── Backfills ─────────────────────────────────────────────────────────────────

backfill-organic-score:
	$(ENV) DATABASE_DRIVER=standard DATABASE_URL=$$DATABASE_URL_LOCAL tsx scripts/backfill/backfill-organic-score.ts'

backfill-organic-score-prod:
	$(ENV) DATABASE_DRIVER=standard tsx scripts/backfill/backfill-organic-score.ts'

backfill-repo-metrics:
	$(ENV) DATABASE_DRIVER=standard DATABASE_URL=$$DATABASE_URL_LOCAL tsx scripts/backfill/backfill-repo-metrics.ts'

backfill-repo-metrics-prod:
	$(ENV) DATABASE_DRIVER=standard NEXT_PUBLIC_ORGANIC_SCORE_ENABLED=true tsx scripts/backfill/backfill-repo-metrics.ts'

backfill-repo-languages:
	$(ENV) tsx scripts/backfill/backfill-repo-languages.ts'

backfill-repo-languages-prod:
	$(ENV) tsx scripts/backfill/backfill-repo-languages.ts --prod'

backfill-user-top-repos:
	$(ENV) DATABASE_URL=$$DATABASE_URL_LOCAL tsx scripts/backfill/backfill-user-top-repos.ts'

backfill-user-top-repos-prod:
	$(ENV) tsx scripts/backfill/backfill-user-top-repos.ts'

backfill-languages:
	$(ENV) tsx scripts/backfill/backfill-languages.ts'

backfill-languages-prod:
	$(ENV) tsx scripts/backfill/backfill-languages.ts --prod'

# ─── Collect + batch scan ──────────────────────────────────────────────────────

collect-repos:
	$(ENV) tsx scripts/ops/collect-user-repos.ts'

collect-trending:
	$(ENV) tsx scripts/ops/collect-trending-repos.ts'

collect-trending-no-ts:
	$(ENV) tsx scripts/ops/collect-trending-repos.ts --exclude-language typescript --exclude-language javascript'

collect-merge:
	node -e "const fs=require('fs'),g=p=>fs.existsSync(p)?require(p):[];const a=g('./scripts/repos-from-users.json'),b=g('./scripts/repos-trending.json'),m=[...new Set([...a,...b])];fs.writeFileSync('scripts/repos-all.json',JSON.stringify(m,null,2));console.log('Merged:',m.length,'repos')"

batch-scan:
	$(ENV) caffeinate -i tsx scripts/ops/batch-scan.ts --local --input scripts/repos-all.json'

batch-scan-dry:
	$(ENV) tsx scripts/ops/batch-scan.ts --local --input scripts/repos-all.json --dry-run'

index-repo: ## make index-repo REPO=owner/repo
	$(ENV) caffeinate -i tsx scripts/ops/index-repo.ts $(REPO)'

index-repo-local: ## make index-repo-local REPO=owner/repo
	$(ENV) caffeinate -i tsx scripts/ops/index-repo.ts --base-url http://localhost:3000 $(REPO)'

index-followers: ## make index-followers LOGIN=FlorianBruniaux
	$(ENV) caffeinate -i tsx scripts/ops/index-followers.ts $(LOGIN)'

index-followers-local: ## make index-followers-local LOGIN=FlorianBruniaux
	$(ENV) caffeinate -i tsx scripts/ops/index-followers.ts --base-url http://localhost:3000 $(LOGIN)'

index-followers-all: ## make index-followers-all [MIN_FOLLOWERS=100] [LIMIT=n]
	$(ENV) caffeinate -i tsx scripts/ops/batch-index-followers.ts --prod --min-followers $(or $(MIN_FOLLOWERS),100) $(if $(LIMIT),--limit $(LIMIT))'

index-followers-all-local: ## make index-followers-all-local [MIN_FOLLOWERS=100] [LIMIT=n]
	$(ENV) caffeinate -i tsx scripts/ops/batch-index-followers.ts --min-followers $(or $(MIN_FOLLOWERS),100) $(if $(LIMIT),--limit $(LIMIT))'

refresh-follower-cache: ## make refresh-follower-cache LOGINS=FlorianBruniaux[,other]
	$(ENV) caffeinate -i tsx scripts/ops/batch-index-followers.ts --prod --logins $(LOGINS)'

refresh-follower-cache-local: ## make refresh-follower-cache-local LOGINS=FlorianBruniaux[,other]
	$(ENV) caffeinate -i tsx scripts/ops/batch-index-followers.ts --logins $(LOGINS)'

# ─── Calibration + probes ──────────────────────────────────────────────────────

calibrate-organic-score:
	$(ENV) tsx scripts/ops/calibrate-organic-score.ts'

probe-star-burst:
	$(ENV) tsx scripts/ops/probe-star-burst.ts'

# ─── Maintenance (full pipeline) ──────────────────────────────────────────────

maintenance:
	pnpm maintenance

maintenance-dry:
	bash scripts/ops/maintenance.sh --dry-run

maintenance-sync-only:
	bash scripts/ops/maintenance.sh --skip-backfills

.PHONY: db-sync-to-prod db-sync-from-prod db-dump db-restore db-pull \
        mv-country-stats mv-country-stats-prod mv-country-language mv-country-language-prod \
        mv-user-repo-count mv-user-repo-count-prod mv-trending mv-trending-prod \
        mv-language-grid mv-language-grid-prod \
        idx-geo-velocity idx-geo-velocity-prod \
        refresh-all refresh-all-prod \
        backfill-organic-score backfill-organic-score-prod \
        backfill-repo-metrics backfill-repo-metrics-prod \
        backfill-repo-languages backfill-repo-languages-prod \
        backfill-user-top-repos backfill-user-top-repos-prod \
        backfill-languages backfill-languages-prod \
        maintenance maintenance-dry maintenance-sync-only \
        collect-repos collect-trending collect-trending-no-ts collect-merge batch-scan batch-scan-dry \
        calibrate-organic-score probe-star-burst \
        refresh-follower-cache refresh-follower-cache-local
