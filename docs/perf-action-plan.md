# Plan d'action Performance — StarMapper v2

**Date**: 2026-04-01  
**Source**: Audit 4 agents + critique adversariale  
**Scope**: API, DB, Frontend, Infra

---

## Vue d'ensemble

| Phase | Effort | Risque | Délai |
|-------|--------|--------|-------|
| P0 — Baseline | 30 min | Nul | Avant tout |
| P1 — Quick wins | 2h | Faible | Jour 1 |
| P2 — Structurel | 1 jour | Faible | Jour 2-3 |
| P3 — SQL rewrites | 3-4 jours | Moyen | Semaine 2 |
| Hors scope | — | — | Jamais / trigger |

---

## Phase 0 — Baseline (30 min, bloquant tout le reste)

> Mesurer avant d'optimiser. Sans baseline, les gains annoncés sont des estimations.

- [ ] **React Profiler** — scan un repo ~500 stars, noter nb de re-renders par chunk
- [ ] **Bundle analyzer** — `ANALYZE=true pnpm build`, noter taille world-atlas dans le bundle initial
- [ ] **Latence routes** — `curl -w "%{time_total}\n"` sur `/api/stats`, `/api/repos`, `/api/explore/global-map`
- [ ] **pg_trgm** — `SELECT * FROM pg_available_extensions WHERE name = 'pg_trgm'` sur Neon (conditionne P3.E)
- [ ] **Choropleth usage** — `grep -r "country-choropleth" src/ --include="*.tsx"` pour confirmer que le dynamic wrapper est le seul point d'entrée

**Decision gates** :
- world-atlas absent du bundle → P1.E inutile, skip
- re-renders déjà batchés React 18 → descendre P1.B en P2
- `pg_trgm` absent → P3.E supprimé

---

## Phase 1 — Quick Wins (2h, non-risqués)

### P1.A — MapLibre CSS dupliqué [-30KB]
- **Fichiers** : `src/components/map/stargazer-map.tsx:9`, `src/components/map/country-choropleth.tsx:8`
- **Action** : Supprimer les deux imports CSS dans les composants. Ajouter `@import "maplibre-gl/dist/maplibre-gl.css"` dans `src/app/globals.css`
- **Validation** : `pnpm build` sans warning + map s'affiche correctement en local
- **Rollback** : `git revert`

### P1.B — React rendering — item atomique (memo + reducer + useMemo)
> Ces 3 items sont interdépendants. Un seul PR, pas trois.

- **Fichiers** : `stargazer-map.tsx:309`, `page.tsx:366-370`, `stargazer-map.tsx:603-612`
- **Actions** :
  1. `React.memo(StargazerMap, (prev, next) => prev.points === next.points)` — référence, pas longueur
  2. `useReducer` pour `{points, unmapped, processed}` dans `page.tsx` — 1 dispatch par chunk
  3. `useMemo(() => buildGeoJSON(points), [points])` dans StargazerMap — 1 seul build par update
- **Validation** : React Profiler ≤ 1 re-render par chunk (comparer baseline Phase 0)
- **Rollback** : `git revert`

### P1.C — Nominatim delay 1100ms → 300ms
- **Fichier** : `src/lib/geocoder.ts`
- **Action** : `sleep(1100)` → `sleep(300)`
- **Validation** : log geocoder sur scan avec fallback Nominatim, confirmer < 400ms/call
- **Rollback** : 1 ligne à changer

### P1.D — Index `stargazer_cache.expiresAt`
- **Fichier** : `prisma/schema.prisma`
- **Action** : `@@index([expiresAt])` sur `StargazerCache` + `prisma db push`
- **Validation** : `prisma db push` sans erreur

### P1.E — world-atlas dynamic import [-600KB bundle initial] *(conditionnel Phase 0)*
- **Fichier** : `src/components/map/country-choropleth.tsx:14`
- **Prérequis** : confirmer que le wrapper `CountryChoroplethDynamic` est le seul import dans l'app
- **Action** : Remplacer `require("world-atlas/...")` par `fetch()` lazy dans le composant
- **Validation** : bundle analyzer montre world-atlas absent du chunk initial
- **Rollback** : `git revert`

**Commit P1** : `perf(frontend+infra): quick wins — css dedup, memo, reducer, nominatim, index`

---

## Phase 2 — Fixes structurels (1 jour)

### P2.A — Event listeners MapLibre non nettoyés
- **Fichier** : `src/components/map/stargazer-map.tsx:521-585`
- **Action** : Ajouter `.off()` pour les 11 listeners dans le return du `useEffect` d'init
- **Validation** : Monter/démonter 3 fois, 0 listener dupliqué dans la console MapLibre
- **Rollback** : `git revert`

### P2.B — Profile fetch popup non dédupliqué
- **Fichier** : `src/components/map/stargazer-map.tsx:277`
- **Action** : `const profileCache = useRef(new Map<string, Promise<unknown>>())` — même login = même Promise
- **Validation** : Cliquer 3× sur le même user = 1 seul appel réseau dans Network tab

### P2.C — `repo-info` + `stargazer-cache` fetches séquentiels → parallèles
- **Fichier** : `src/app/[owner]/[repo]/page.tsx:217-293`
- **Action** : `Promise.all([fetchRepoInfo(), fetchStargazerCache()])` dans un seul `useEffect`
- **Validation** : Network tab — les deux calls partent au même timestamp (delta < 5ms)

### P2.D — `explore/companies` O(n²) dedup → O(n)
- **Fichier** : `src/app/api/explore/companies/route.ts:48-60`
- **Action** : Map inverse `lowercase → canonical` pour lookup O(1) au lieu de `.find()` linéaire
- **Validation** : `console.time` sur 1000 groupes synthétiques < 5ms

### P2.E — Cold start Prisma : `require()` → import statique
- **Fichier** : `src/lib/db.ts:16-32`
- **Action** : Import statique `@prisma/adapter-neon` en tête de fichier, `require("pg")` uniquement dans le branch `standard`
- **Prérequis** : `ANALYZE=true pnpm build` local pour vérifier que `@prisma/adapter-pg` est absent du bundle Neon
- **Validation** : build propre + cold start Vercel mesuré avant/après via Vercel dashboard
- **Rollback** : `git revert` + redeploy

### P2.F — db-sync : paralléliser sans casser les FK
- **Fichier** : `scripts/db-sync-to-neon.sh`
- **Ordre impératif** (FK `star_event → github_user`) :
  1. `sync_table "github_user"` — séquentiel, bloquant
  2. `sync_table "badge_cache" ... &` + `sync_table "stargazer_cache" ... &` + `wait`
  3. `sync_table "star_event"` — séquentiel, après github_user
- **Validation** : temps d'exécution < 60% du temps baseline

**Commit P2** : `perf(frontend+infra): structural fixes — listeners, fetch parallel, cold start, db-sync`

---

## Phase 3 — SQL Rewrites (PR séparées, un item à la fois)

> Chaque item a son propre rollback. Ne pas grouper en un seul commit.

### P3.A — `statement_timeout` Neon *(en premier, protection pour la suite)*
- **Action** :
  ```sql
  ALTER ROLE neondb_owner SET statement_timeout = '10s';
  ALTER DATABASE neondb SET log_min_duration_statement = 1000;
  ```
- **Validation** : `SELECT pg_sleep(15)` retourne une erreur en < 10s
- **Rollback** : `ALTER ROLE ... RESET statement_timeout`

### P3.B — Slow query logging dans `db.ts`
- **Fichier** : `src/lib/db.ts`
- **Action** : `prisma.$on('query', e => { if (e.duration > 1000) console.warn('[SLOW]', e.query, e.duration + 'ms') })`
- **Validation** : query lente artificielle (`SELECT pg_sleep(1.1)`) visible dans logs Vercel

### P3.C — Power stargazers : subquery → INNER JOIN + CTE
- **Fichier** : `src/app/api/stats/[owner]/[repo]/route.ts:96-106`
- **Action** :
  ```sql
  WITH repo_logins AS (
    SELECT DISTINCT login FROM star_event WHERE owner=$1 AND repo=$2
  )
  SELECT se.login, COUNT(*) AS cnt
  FROM star_event se
  INNER JOIN repo_logins USING (login)
  GROUP BY se.login HAVING COUNT(*) > 1
  ORDER BY cnt DESC LIMIT 50
  ```
- **Validation** : comparer output sur 3 repos vs version actuelle avant de supprimer l'ancienne + `EXPLAIN ANALYZE` sans nested loop O(n²)
- **Rollback** : `git revert` + `vercel --prod` < 5 min

### P3.D — `/api/stats` : findMany(10k) → raw SQL groupé *(le plus risqué)*
- **Fichier** : `src/app/api/stats/[owner]/[repo]/route.ts:38-49`
- **Stratégie shadow** :
  1. Écrire la nouvelle query SQL en parallèle de l'ancienne
  2. Logger les diffs de résultats pendant 48h en prod (env var `STATS_SHADOW=true`)
  3. Supprimer l'ancienne seulement si 0 diff constaté
- **Validation** : latence < 500ms sur repo 10k stars + résultats identiques à l'ancienne query
- **Rollback** : env var `STATS_SHADOW=false` → bascule immédiate sur l'ancienne query

### P3.E — GIN indexes ILIKE *(conditionnel sur `pg_trgm` disponible — Phase 0)*
- **Action** :
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX CONCURRENTLY github_user_location_gin ON github_user USING gin(location gin_trgm_ops);
  CREATE INDEX CONCURRENTLY github_user_company_gin  ON github_user USING gin(company  gin_trgm_ops);
  ```
  > `CONCURRENTLY` = pas de lock table en prod
- **Validation** : `EXPLAIN` sur `WHERE location ILIKE '%paris%'` montre `Bitmap Index Scan`
- **Rollback** : `DROP INDEX CONCURRENTLY ...`

### P3.F — `explore/power` : keyset pagination
- **Fichier** : `src/app/api/explore/power/route.ts:26-39`
- **Action** : Remplacer `OFFSET ${skip}` par cursor sur `(cnt DESC, login ASC)` — temps de réponse constant quelle que soit la page
- **Validation** : page 1 vs page 50 : delta de latence < 20ms

### P3.G — `next.config.ts` : optimisation images
- **Fichier** : `next.config.ts`
- **Action** : `images.remotePatterns` pour `avatars.githubusercontent.com` + `formats: ['image/avif', 'image/webp']`
- **Validation** : `pnpm build` sans warning, avatar servi en WebP dans Network tab

---

## Hors scope — avec trigger conditions

| Item | Pourquoi déféré | Trigger pour y revenir |
|------|----------------|------------------------|
| GitHub `socialAccounts(first:5)→1` | Impact quota nul en pratique | Erreur 403 GraphQL en prod |
| Lazy token refresh middleware | Gain < 5ms, risque sécurité non évalué | Jamais — complexité injustifiée |
| Circuit breaker half-open geocoder | Over-engineering pour <1% des scans | > 3 incidents Nominatim/mois |
| Materialized view `global-map` | Cache HTTP 1h suffit | `/api/explore/global-map` > 2s mesuré |
| Pagination explore/locations | Pas de bug report utilisateur | Premier bug report pagination |
| `classifyRoute()` Map lookup | 0.5ms non perceptible | Jamais |
| `RepoTable` / `CommandSearch` memo | Landing page peu dynamique | Après P1.B mesuré insuffisant |

---

## Critères de succès (tous mesurables)

| Métrique | Méthode de mesure | Cible |
|----------|------------------|-------|
| Re-renders par chunk | React DevTools Profiler | ≤ 1 |
| world-atlas dans bundle | `ANALYZE=true pnpm build` | Absent du chunk initial |
| `/api/stats` latence | `curl -w "%{time_total}"` | < 500ms sur 10k stars |
| Cold start Vercel | Vercel dashboard → Function duration p50 | < 200ms |
| statement_timeout actif | `SELECT pg_sleep(15)` | Erreur en < 10s |
| Listeners dupliqués | Console MapLibre après remount ×3 | 0 |
| Fetch waterfall map page | Network tab timestamp delta | < 5ms entre repo-info et stargazer-cache |

---

## Rollback global

| Phase | Méthode | Temps |
|-------|---------|-------|
| P1 | `git revert HEAD` + auto-deploy Vercel | < 3 min |
| P2 | `git revert HEAD~N` + redeploy | < 5 min |
| P3.A | `ALTER ROLE RESET statement_timeout` | < 1 min |
| P3.C-D | `git revert` + `vercel --prod` | < 5 min |
| P3.E | `DROP INDEX CONCURRENTLY ...` | < 2 min |

---

*v2 — 2026-04-01 — intègre critique adversariale : baseline obligatoire, items atomiques, rollbacks explicites, scope creep retiré*
