# Plan d'action — Slow Queries StarMapper

**Date** : 2026-04-01
**Source** : Neon query performance data (20+ entrées, top slow queries analysées)

---

## Slow queries identifiées

| Pattern Neon | Avg ms | Calls | Source |
|---|---|---|---|
| `IN ($1...$10000) OFFSET $10001` | 467ms | 8 | `/api/stats` — `findMany(10k)` génère IN clause massive |
| `COUNT(*) FROM star_event WHERE $2=$3 OFFSET $1` | 944ms | 4 | `/api/explore/power` — `countRows` recalculé à chaque appel |
| `GROUP BY location ORDER BY count DESC` | 365ms | 9 | `/api/explore/locations` — `take: 5000` + agrégation JS |
| Power stargazers CTE `INNER JOIN repo_logins` | 520ms | 6 | `/api/stats/[owner]/[repo]` — hash join sur full table |
| Global-map grid `GROUP BY ROUND(lat,0)` | 1000ms | 2 | `/api/explore/global-map` — expression non indexable |

---

## Phase 1 — Quick wins sans migration (XS, < 2h)

### Fix 1.1 — Cache du COUNT dans `/api/explore/power`

**Problème** : `SELECT COUNT(*) AS total FROM (SELECT 1 FROM star_event GROUP BY login HAVING COUNT(*) > 1) subq` — full table scan à chaque appel, y compris sur les pages avec cursor.

**Fix** : ne calculer `countRows` que sur page 1 sans cursor. Ajouter un cache module-level avec TTL 5min pour éviter le scan sur chaque pagination.

```ts
// Cache total in-memory (approximate, 5min TTL)
let _totalCache: { value: number; ts: number } | null = null;
const getTotalPowerUsers = async (): Promise<number> => {
  const now = Date.now();
  if (_totalCache && now - _totalCache.ts < 5 * 60 * 1000) return _totalCache.value;
  const [row] = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COUNT(*) AS total FROM (SELECT 1 FROM star_event GROUP BY login HAVING COUNT(*) > 1) subq
  `;
  const value = Number(row?.total ?? 0);
  _totalCache = { value, ts: now };
  return value;
};
```

- Impact : **-944ms** par appel avec cursor (disparition du COUNT scan)
- Risque rollback : nul

### Fix 1.2 — Réduire `take: 5000` dans `/api/explore/locations`

**Problème** : 5 000 lignes transférées vers Node.js pour `parseLocation()` JS, alors que les 300 top locations couvrent ~95% des cas (loi de puissance).

**Fix** : `take: 300` (ou 500 si besoin de couverture plus large pour les filtres `country=`).

- Fichier : `src/app/api/explore/locations/route.ts`
- Impact : **-70%** sur la query (-250ms environ)
- Risque rollback : faible — les villes rares en fin de liste disparaissent

---

## Phase 2 — Index ciblés (S, 2-4h + `prisma db push`)

### Fix 2.1 — Index covering `(owner, repo, login)` sur `star_event`

**Problème** : le CTE `SELECT DISTINCT login FROM star_event WHERE owner=$1 AND repo=$2` fait un heap fetch car l'index `(owner, repo)` ne couvre pas `login`. Sans le covering index, PostgreSQL doit lire les rows de `star_event` pour récupérer `login`.

**Fix** : ajouter dans `prisma/schema.prisma` sur le modèle `StarEvent` :

```prisma
@@index([owner, repo, login])
```

Puis :
```bash
npx prisma db push
```

- Impact sur SQ-4 : **-60 à 80%** (index-only scan du CTE)
- Impact sur SQ-1 : **-20 à 30%** (scan initial plus rapide)
- Risque rollback : très faible — `DROP INDEX` si problème

### Fix 2.2 — Index fonctionnel partiel pour le grid global-map

**Problème** : `GROUP BY ROUND(lat::numeric, 0), ROUND(lng::numeric, 0)` — expression non indexable via l'index `(lat, lng)` existant.

**Fix** : migration SQL raw (Prisma ne gère pas les index fonctionnels) :

```sql
CREATE INDEX CONCURRENTLY idx_github_user_grid
ON github_user (ROUND(lat::numeric, 0), ROUND(lng::numeric, 0))
WHERE lat IS NOT NULL AND lng IS NOT NULL;
```

- Impact sur SQ-5 : **-50 à 70%** si le planner utilise l'index
- Risque rollback : faible — `DROP INDEX CONCURRENTLY idx_github_user_grid`

---

## Phase 3 — Refactoring query architecture (M–L, 4-8h)

### Fix 3.1 — Agréger directement en SQL dans `/api/stats`

**Problème** : `findMany({ take: 10_000 })` → charge 10k rows → IN clause massive → agrégation JS en mémoire. C'est l'origine du pattern `IN ($1...$10000)`.

**Fix** : remplacer le bloc `findMany` par des queries SQL dédiées par agrégat :

```sql
-- Totaux + mapping rate + avg followers
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE u.lat IS NOT NULL) AS mapped,
  AVG(u.followers)::int AS avg_followers,
  COUNT(*) FILTER (WHERE u.data_version >= 1) AS enriched,
  COUNT(*) FILTER (WHERE u.data_version >= 1 AND u.followers < 5 AND u.following < 5 AND u.public_repos < 2) AS bots
FROM star_event se
JOIN github_user u USING (login)
WHERE se.owner = $1 AND se.repo = $2;

-- Top locations (countries/cities via parseLocation côté Node sur 200 rows max)
SELECT u.location, COUNT(*) AS cnt
FROM star_event se
JOIN github_user u USING (login)
WHERE se.owner = $1 AND se.repo = $2 AND u.location IS NOT NULL
GROUP BY u.location
ORDER BY cnt DESC
LIMIT 200;

-- Top companies
SELECT u.company, COUNT(*) AS cnt
FROM star_event se
JOIN github_user u USING (login)
WHERE se.owner = $1 AND se.repo = $2 AND u.company IS NOT NULL
GROUP BY u.company
ORDER BY cnt DESC
LIMIT 50;

-- Top users (by followers + by publicRepos, deduplicated client-side)
SELECT u.login, u.name, u.followers, u.public_repos, u.location, u.company
FROM star_event se
JOIN github_user u USING (login)
WHERE se.owner = $1 AND se.repo = $2
ORDER BY u.followers DESC
LIMIT 60;
```

- Impact : **disparition de l'IN clause** — réduction de ~90% du temps query SQ-1
- Effort : M — 5-6 queries + refactoriser l'assemblage du `RepoStats`
- Risque rollback : moyen — valider avec un assert `total ≈ total_ancien` sur un repo connu

### Fix 3.2 — Colonnes dénormalisées `countryNormalized` / `cityNormalized`

**Problème** : `parseLocation()` est une fonction JS qui ne peut pas être poussée en SQL, forçant le transfert de milliers de strings brutes.

**Fix** : ajouter deux colonnes à `GitHubUser` :

```prisma
model GitHubUser {
  // ... colonnes existantes
  countryNormalized String?
  cityNormalized    String?
}
```

- Populer lors de l'enrichissement utilisateur dans `user-cache.ts`
- Backfill via script one-shot sur les utilisateurs existants
- Adapter `/api/explore/locations` pour utiliser `GROUP BY countryNormalized`

- Impact sur SQ-3 : **-80%** (une query `GROUP BY countryNormalized LIMIT 50` au lieu de 5k rows)
- Effort : L — migration + backfill + adaptation pipeline + routes
- Risque rollback : élevé — colonnes nullable, backfill progressif, rollback = `DROP COLUMN`

---

## Phase 4 — Optimisations avancées (L, optionnel selon résultats Phase 1-3)

### Fix 4.1 — Materialized view pour `/api/explore/global-map`

Si le Fix 2.2 (index fonctionnel) ne suffit pas et que SQ-5 reste > 500ms :

```sql
CREATE MATERIALIZED VIEW github_user_grid_mv AS
SELECT
  ROUND(lat::numeric, 0)::float AS lat,
  ROUND(lng::numeric, 0)::float AS lng,
  COUNT(*) AS count,
  SUM(followers) AS total_followers,
  (ARRAY_AGG(login ORDER BY followers DESC))[1] AS top_user
FROM github_user
WHERE lat IS NOT NULL AND lng IS NOT NULL
GROUP BY ROUND(lat::numeric, 0), ROUND(lng::numeric, 0);

CREATE UNIQUE INDEX ON github_user_grid_mv (lat, lng);
```

Refresh déclenché après chaque batch d'enrichissement géographique :

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY github_user_grid_mv;
```

- Impact : **-99%** — la route devient un `SELECT * FROM github_user_grid_mv` < 5ms
- Effort : L — mv + refresh hook + documentation sur la staleness intentionnelle

### Fix 4.2 — Réutiliser la mv power dans `/api/stats`

Si le Fix 4.1 est en place, le bloc power stargazers dans `/api/stats` peut consulter la même vue agrégée au lieu de recalculer le CTE.

---

## Séquençage recommandé

```
Semaine 1
  [1h]  Fix 1.1 — Cache COUNT power users
  [30m] Fix 1.2 — take: 5000 → 300 locations
  [1h]  Fix 2.1 — Index (owner, repo, login) + prisma db push
  [30m] Fix 2.2 — Index fonctionnel grid via psql direct

Semaine 2
  [6h]  Fix 3.1 — Réécriture SQL /api/stats (si bench Phase 1 insuffisant)

Semaine 3+
  Fix 3.2 / 4.1 / 4.2 selon mesures post-Phase 1-2
```

**Critère de succès** :
- [ ] SQ-2 (944ms) : disparaît des slow queries Neon après Fix 1.1
- [ ] SQ-3 (365ms) : < 100ms après Fix 1.2 + 2.1
- [ ] SQ-4 (520ms) : < 150ms après Fix 2.1
- [ ] SQ-5 (1000ms) : < 300ms après Fix 2.2
- [ ] SQ-1 (467ms) : disparaît après Fix 3.1

---

## Rollback par fix

| Fix | Rollback |
|---|---|
| 1.1 | Supprimer le cache module-level, restaurer la query directe |
| 1.2 | Remettre `take: 5000` |
| 2.1 | `DROP INDEX star_event_owner_repo_login_idx` |
| 2.2 | `DROP INDEX CONCURRENTLY idx_github_user_grid` |
| 3.1 | Restaurer le `findMany` depuis git (`git revert`) |
| 3.2 | `ALTER TABLE github_user DROP COLUMN countryNormalized, DROP COLUMN cityNormalized` |
| 4.1 | `DROP MATERIALIZED VIEW github_user_grid_mv` |
