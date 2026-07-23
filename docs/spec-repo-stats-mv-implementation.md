# Spec d'implémentation : vues matérialisées par repo

**Date**: 2026-07-23
**Branche**: `fix/stats-timeouts-and-prod-log-noise`
**Décision amont**: `docs/adr-repo-stats-precompute.md` (option 1, actée)
**Diagnostic amont**: `research-stats-timeouts.md`

Ce document est un audit d'intégration de la section 4 de l'ADR contre l'état réel du repo,
puis la spec exécutable qui en découle. Quatre corrections sont apportées à l'ADR, chacune
avec sa preuve. Le choix d'option n'est pas rediscuté.

Toutes les mesures Neon citées ici ont été refaites le 2026-07-23 sur l'endpoint direct
(sans `-pooler`), en lecture seule.

---

## 0. Résumé des corrections apportées à l'ADR

| # | Point ADR | Verdict | Section |
|---|---|---|---|
| 1 | Propager `source` + `computedAt` dans 8 fichiers | **Corrigé** : 1 seul fichier à modifier si les champs sont optionnels | §1 |
| 2 | Définitions SQL dans `prisma/sql/views.sql` | **Complété** : views.sql + fichier dédié dans `scripts/db/sql/` | §2 |
| 3 | Découpage cron `part=1` / `part=2` | **Corrigé** : rééquilibrage, la justification du créneau change aussi | §3 |
| 4 | Flag `REPO_STATS_MV_ENABLED` | **Confirmé**, avec une contrainte de lecture non triviale | §4 |
| 5 | `NOW()` dans `repo_stats_mv` | **Confirmé**, `clock_timestamp()` serait pire | §5 |
| 6 | Risque `REFRESH CONCURRENTLY` sur vue vide | **Corrigé** : la prémisse est fausse, le garde-fou reste utile | §6 |
| 7 | Pièges Neon | **Confirmé** : rien dans le plan ne les viole | §7 |

---

## 1. Propagation du type `RepoStats`

### Ce que dit l'ADR

Section 4, étape 3 : « Ajouter `source` et `computedAt` au type `RepoStats` exporté, et
répercuter dans les consommateurs client. »

### CORRECTION 1 : rendre les deux champs optionnels suffit, un seul fichier à modifier

L'ADR laisse entendre qu'il y a huit fichiers à toucher. Il y en a un.

`RepoStats` apparaît dans sept fichiers hors tests. Sur ces sept, **deux** construisent un
objet, et **un seul** est un littéral typé `RepoStats` :

| Fichier:ligne | Rôle | Modification requise |
|---|---|---|
| `src/app/api/stats/[owner]/[repo]/route.ts:30` | définition du type | **oui**, ajout des 2 champs |
| `src/app/api/stats/[owner]/[repo]/route.ts:255` | `const stats: RepoStats = {...}` | **oui**, seul littéral annoté |
| `src/app/[owner]/[repo]/page.tsx:47,54` | `as RepoStats` + branche `cacheLife` | **oui** (changement voulu, cf. §8.4) |
| `src/app/[owner]/[repo]/page.client.tsx:372` | littéral inféré, non annoté | **non** |
| `src/components/map/share-modal.tsx:27` | prop `RepoStats \| null`, lecture seule | non |
| `src/components/map/stats-modal.tsx:18` | prop `RepoStats`, lecture seule | non (option UI, §8.5) |
| `src/hooks/useScanController.ts:71,232,355` | `React.Dispatch` + 2 casts `as RepoStats` | non |
| `src/hooks/use-repo-cache-loader.ts:30,73` | `useState<RepoStats \| null>` | non |

**Preuve pour `page.client.tsx:372`.** Ce littéral n'est pas annoté `RepoStats`. Son type est
inféré, puis vérifié à l'assignation de prop (`displayStats={displayStats}`, lignes 734 et
762). Le contrôle d'excès de propriétés ne s'applique pas là (ce n'est pas un littéral frais
au site d'assignation), seules les propriétés **requises manquantes** produiraient une erreur.
Or le littéral omet déjà `isPartial`, déclaré `isPartial?: boolean` à `route.ts:45`, et le
projet compile. Le même mécanisme couvre `source?` et `computedAt?`.

Le fichier passe par `displayStats = stats ?? serverStats` (`page.client.tsx:378`), donc le
littéral local et la réponse serveur alimentent le même prop. C'est précisément pour ça que
les champs doivent être optionnels : les stats calculées côté client ne sont ni
`precomputed` ni `live`, et leur inventer une valeur serait un mensonge affiché à
l'utilisateur.

### Diff exact du type

`src/app/api/stats/[owner]/[repo]/route.ts`, après la ligne 45 (`isPartial?: boolean;`) :

```ts
  isPartial?: boolean;
  /**
   * Provenance des agrégats. Absent quand les stats sont calculées côté client
   * (page.client.tsx) ou quand le flag REPO_STATS_MV_ENABLED est désactivé.
   */
  source?: "precomputed" | "live";
  /**
   * Instant du REFRESH de repo_stats_mv, ISO 8601. Présent uniquement quand
   * source === "precomputed".
   * À ne pas confondre avec organic.computedAt (RepoOrganic:17), qui date le
   * calcul du score organique et vient de badge_cache.
   */
  computedAt?: string;
```

Nommage : l'ADR dit `computedAt`, on le garde. Le risque de confusion avec
`RepoStats["organic"]["computedAt"]` est réel mais l'imbrication le désambiguïse, et le
commentaire ci-dessus est là pour l'agent qui touchera `stats-modal.tsx`.

### Piège dans les tests existants (à lire avant de coder)

`src/app/api/stats/[owner]/[repo]/__tests__/route.test.ts:79-83` mocke `prisma.$queryRaw`
**par position** :

```ts
mockQueryRaw
  .mockResolvedValueOnce([totalsRow])                                 // 1. totals
  .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])  // 2. locations
  .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])           // 3. companies
  .mockResolvedValueOnce([]);                                         // 4. power users
```

Toute requête `$queryRaw` supplémentaire insérée **avant** décale les quatre mocks et casse
les 14 tests du fichier d'un coup. Contrainte qui en découle, non négociable :

> Le flag doit être évalué **avant** d'émettre la moindre requête sur les vues. Flag à
> `false` ou absent : la séquence de `$queryRaw` doit être identique, au nombre et à l'ordre,
> à celle d'aujourd'hui.

Les tests existants ne stubent aucun env, donc `REPO_STATS_MV_ENABLED` y sera `undefined`, et
ils doivent passer sans une seule ligne modifiée. C'est le critère de non-régression le plus
simple à vérifier : `pnpm vitest run src/app/api/stats` doit rester vert avant même d'écrire
les nouveaux tests.

---

## 2. Emplacement des définitions SQL

### Convention réelle de `prisma/sql/views.sql`

Lu en entier (234 lignes). Format confirmé :

1. En-tête de fichier : bloc de commentaires `--`, puis `SET statement_timeout = 0;` ligne 10.
   Une seule fois pour tout le fichier, pas par vue.
2. Sections numérotées, séparateur `-- ====…====` de 60 signes égal, titre `-- N. nom_mv`,
   deux ou trois lignes de commentaire expliquant à quoi sert la vue et qui la lit.
3. `CREATE MATERIALIZED VIEW IF NOT EXISTS <nom> AS` puis le SELECT indenté de 2 espaces.
   Jamais de `WITH NO DATA`.
4. `CREATE UNIQUE INDEX IF NOT EXISTS <nom>_pk_idx` ou `<nom>_<cols>_idx` immédiatement après,
   puis les index secondaires. Jamais `CONCURRENTLY` (rappel ligne 8 du fichier).
5. Ordre : extensions, puis index hors MV, puis les 9 vues de 1 à 9.

Les vues 1 à 9 sont donc à suivre par `-- 10.` à `-- 13.`.

### Comment `views.sql` est exécuté

`scripts/db/setup-mvs.ts:20-29` lit le fichier et l'envoie en **un seul**
`client.query(sql)`. Avec node-pg, une requête simple multi-instructions s'exécute dans une
transaction implicite unique. Trois conséquences directes :

- `SET statement_timeout = 0` de la ligne 10 couvre bien tout le reste du fichier.
- L'ajout des 4 vues fait passer `pnpm setup:mvs` / `pnpm db:setup` d'une exécution courte à
  environ 306 secondes de plus, dans une seule transaction. Tout ou rien.
- Sur une base déjà en place, les `IF NOT EXISTS` court-circuitent tout, donc le coût n'est
  payé qu'une fois par instance.

`pnpm db:setup` (`package.json:25`) appelle `scripts/db/db-setup.sh`, `pnpm setup:mvs` et
`setup:mvs:prod` (`package.json:73-74`) appellent directement `setup-mvs.ts`.

### CORRECTION 2 : les deux emplacements, pas un seul

L'ADR ne mentionne que `views.sql`. Le repo a une convention de duplication systématique que
l'ADR n'a pas relevée : chaque MV lourde a **aussi** son fichier dédié dans `scripts/db/sql/`
(`create-trending-mv.sql`, `create-user-repo-count-mv.sql`, `create-country-stats-mv.sql`,
`create-language-grid-mv.sql`, `create-country-language-mv.sql`). Ces fichiers portent leur
propre `SET statement_timeout = 0;` et servent à créer une vue isolément sur une base déjà
initialisée, sans rejouer les 9 autres.

C'est exactement le besoin de l'étape 2 de l'ADR (création en prod). Livrer les deux :

- `prisma/sql/views.sql` : sections 10 à 13, canonique, garantit qu'une base fraîche est
  complète.
- `scripts/db/sql/create-repo-stats-mvs.sql` : les quatre vues seules, c'est **ce fichier qui
  est joué en prod** via `psql "$DIRECT_URL" -f`.

Le contenu SQL est identique mot pour mot entre les deux, comme pour les cinq précédentes.

### SQL complet des quatre vues

À insérer tel quel à la fin de `prisma/sql/views.sql`, et à reprendre dans
`scripts/db/sql/create-repo-stats-mvs.sql` précédé de son propre `SET statement_timeout = 0;`.

```sql
-- ============================================================
-- 10. repo_stats_mv
-- ============================================================
-- Agrégats scalaires par repo pour GET /api/stats/[owner]/[repo].
-- Reproduit à l'identique la requête totals de route.ts:94-103 (INNER JOIN inclus :
-- un star_event sans github_user correspondant n'est pas compté, comme aujourd'hui).
-- computed_at sert à afficher la fraîcheur côté interface. Il ne figure QUE sur cette
-- vue : sa valeur change à chaque REFRESH, donc toutes les lignes sont vues comme
-- modifiées par le diff de REFRESH CONCURRENTLY. Négligeable sur 2 500 lignes,
-- coûteux sur les 344 000 de repo_location_stats_mv.

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_stats_mv AS
  SELECT
    se.owner,
    se.repo,
    COUNT(*)::bigint                                                        AS total,
    COUNT(*) FILTER (WHERE u.lat IS NOT NULL AND u.lng IS NOT NULL)::bigint AS mapped,
    COALESCE(AVG(u.followers)::int, 0)                                      AS avg_followers,
    COUNT(*) FILTER (WHERE u."dataVersion" >= 1)::bigint                    AS enriched,
    COUNT(*) FILTER (
      WHERE u."dataVersion" >= 1
        AND u.followers < 5
        AND u.following < 5
        AND u."publicRepos" < 2
    )::bigint                                                               AS bots,
    NOW()                                                                   AS computed_at
  FROM star_event se
  JOIN github_user u USING (login)
  GROUP BY se.owner, se.repo;

CREATE UNIQUE INDEX IF NOT EXISTS repo_stats_mv_pk_idx
  ON repo_stats_mv (owner, repo);

-- ============================================================
-- 11. repo_location_stats_mv
-- ============================================================
-- Top 200 locations BRUTES par repo. Volontairement pas countryNormalized :
-- sur un TABLESAMPLE SYSTEM (2) de github_user, 45 823 lignes ont location
-- renseignée contre 17 010 pour countryNormalized. parseLocation() côté JS
-- reste l'unique point de normalisation, comme à route.ts:203-208.
-- Bornes identiques à route.ts:165 (LIMIT 200).

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_location_stats_mv AS
  SELECT owner, repo, location, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      u.location,
      COUNT(*) AS cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY COUNT(*) DESC, u.location ASC
      ) AS rn
    FROM star_event se
    JOIN github_user u USING (login)
    WHERE u.location IS NOT NULL
    GROUP BY se.owner, se.repo, u.location
  ) t
  WHERE rn <= 200;

CREATE UNIQUE INDEX IF NOT EXISTS repo_location_stats_mv_pk_idx
  ON repo_location_stats_mv (owner, repo, location);

CREATE INDEX IF NOT EXISTS repo_location_stats_mv_cnt_idx
  ON repo_location_stats_mv (owner, repo, cnt DESC);

-- ============================================================
-- 12. repo_company_stats_mv
-- ============================================================
-- Top 50 companies par repo. Borne identique à route.ts:175 (LIMIT 50).

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_company_stats_mv AS
  SELECT owner, repo, company, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      u.company,
      COUNT(*) AS cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY COUNT(*) DESC, u.company ASC
      ) AS rn
    FROM star_event se
    JOIN github_user u USING (login)
    WHERE u.company IS NOT NULL
    GROUP BY se.owner, se.repo, u.company
  ) t
  WHERE rn <= 50;

CREATE UNIQUE INDEX IF NOT EXISTS repo_company_stats_mv_pk_idx
  ON repo_company_stats_mv (owner, repo, company);

CREATE INDEX IF NOT EXISTS repo_company_stats_mv_cnt_idx
  ON repo_company_stats_mv (owner, repo, cnt DESC);

-- ============================================================
-- 13. repo_power_users_mv
-- ============================================================
-- Top 20 power users par repo. Équivalent précalculé de la CTE MATERIALIZED de
-- route.ts:189-197, mêmes colonnes de sortie (login, cnt) et même tri.
-- DÉPEND de power_users_mv : à rafraîchir APRÈS elle, jamais avant.
-- name/followers ne sont volontairement pas stockés ici : la route les relit par
-- clé primaire sur 20 logins (route.ts:214-219), c'est instantané et ça évite de
-- figer des compteurs de followers qui bougent tous les jours.

CREATE MATERIALIZED VIEW IF NOT EXISTS repo_power_users_mv AS
  SELECT owner, repo, login, cnt
  FROM (
    SELECT
      se.owner,
      se.repo,
      mv.login,
      mv.cnt,
      ROW_NUMBER() OVER (
        PARTITION BY se.owner, se.repo
        ORDER BY mv.cnt DESC, mv.login ASC
      ) AS rn
    FROM star_event se
    JOIN power_users_mv mv USING (login)
  ) t
  WHERE rn <= 20;

CREATE UNIQUE INDEX IF NOT EXISTS repo_power_users_mv_pk_idx
  ON repo_power_users_mv (owner, repo, login);

CREATE INDEX IF NOT EXISTS repo_power_users_mv_cnt_idx
  ON repo_power_users_mv (owner, repo, cnt DESC);
```

### Validation déjà faite sur ce SQL

`EXPLAIN` (planification seule, sans exécution) lancé sur Neon prod le 2026-07-23 pour
`repo_stats_mv`, `repo_location_stats_mv` et `repo_power_users_mv`. Les trois planifient sans
erreur, donc pas de faute de colonne ni de syntaxe. Plans obtenus :

- `repo_stats_mv` : `Finalize GroupAggregate` sur `Parallel Hash Join`, deux `Parallel Seq
  Scan` (star_event puis github_user en table de hachage). Conforme à ce que décrit l'ADR
  section 2.
- `repo_location_stats_mv` : `WindowAgg` avec `Run Condition: row_number() <= 200`. Postgres
  pousse la borne dans la fenêtre au lieu de matérialiser toutes les partitions, c'est ce qui
  rend le `ROW_NUMBER()` viable ici.
- `repo_power_users_mv` : `Parallel Hash Join` star_event × power_users_mv puis tri de
  l'ordre de 20 millions de lignes. Avec `work_mem = 4MB` ce tri déborde sur disque, c'est
  l'origine des 62 secondes mesurées. Rien à corriger, mais ne pas s'étonner du volume de
  fichiers temporaires.

Taille des clés d'index : sur un `TABLESAMPLE SYSTEM (3)` de `github_user`,
`max(octet_length(location)) = 170` et `max(octet_length(company)) = 237`. Très loin de la
limite btree de 2704 octets par entrée. Les index uniques sur `(owner, repo, location)` et
`(owner, repo, company)` ne poseront pas de problème.

Le tie-break `, u.location ASC` et `, u.company ASC` dans le `ORDER BY` du `ROW_NUMBER()` est
une addition par rapport à l'ADR. Sans lui, deux locations à égalité de compte se départagent
arbitrairement, et le jeu de 200 retenues peut changer d'un REFRESH à l'autre sans qu'aucune
donnée n'ait bougé. Le diff de `REFRESH CONCURRENTLY` verrait alors des insertions et
suppressions fantômes.

---

## 3. Créneaux cron

### État réel de `vercel.json`

Quatre crons, tous en UTC :

| Chemin | Schedule | Heures UTC | `maxDuration` |
|---|---|---|---|
| `/api/admin/cleanup` | `0 3 1 * *` | 03:00 le 1er du mois | non déclaré (défaut) |
| `/api/admin/refresh-grid-mv` | `0 */4 * * *` | 00, 04, 08, 12, 16, 20 | 300 (`route.ts:23`) |
| `/api/admin/refresh-trending` | `30 */6 * * *` | 00:30, 06:30, 12:30, 18:30 | 300 (`route.ts:23`) |
| `/api/admin/daily-digest` | `0 6 * * *` | 06:00 | non déclaré |

### CORRECTION 3a : la justification du créneau 02:20 donnée par l'ADR n'est pas la bonne

L'ADR écrit : « Le créneau de 02:20 laisse `power_users_mv` se terminer d'abord : le cron
`/api/admin/refresh-grid-mv` tourne à `0 */4 * * *`, donc à 00:00 pour le passage précédent. »
C'est vrai mais ça ne prouve rien, puisque la durée du passage de 00:00 n'est pas bornée par
cet argument.

La vraie garantie est structurelle : `src/app/api/admin/refresh-grid-mv/route.ts:23` déclare
`export const maxDuration = 300`. Vercel termine la fonction de force à 300 secondes. Le
passage de 00:00 ne peut donc **pas** être encore en cours après 00:05, quelle que soit sa
durée réelle. Le créneau 02:00 dispose de 115 minutes de marge, celui de 02:20 de 135.

Mesurer la durée réelle de `refresh-grid-mv` n'est ni nécessaire ni possible proprement :
`pg_stat_statements` n'est pas installé sur la base Neon de prod (vérifié,
`SELECT count(*) FROM pg_extension WHERE extname='pg_stat_statements'` renvoie 0), et la seule
autre voie serait de relancer les REFRESH, donc d'écrire en prod.

Signal indirect que la boucle va bien jusqu'au bout : `city_stats_mv`, huitième et dernière
de `MV_NAMES` (`refresh-grid-mv/route.ts:49-58`), porte un `last_autoanalyze` au
2026-07-22 16:48, cohérent avec le passage de 16:00.

### CORRECTION 3b : le découpage de l'ADR est déséquilibré

L'ADR propose `part=1` = {stats 60 s, location 40 s} ≈ 100 s et `part=2` = {company 145 s,
power 62 s} ≈ 207 s. Sur un `maxDuration` de 300, `part=2` ne garde que 31 % de marge. Or le
diagnostic amont a mesuré un facteur 2 à 4 entre cache Neon chaud et froid sur ce type de
requête, et 145 s est justement la mesure la plus atypique des quatre (un top 50 qui coûte
trois fois un top 200, c'est le signe d'une mesure prise à froid). 207 × 1,5 = 310 s, soit
au-delà de la coupure.

Répartition équilibrée des mêmes quatre durées : {145, 40} contre {60, 62}, soit 185 s et
122 s. Le pire cas passe de 207 à 185 s, la marge de 31 à 38 %.

Contrainte de dépendance vérifiée : `repo_power_users_mv` lit `power_users_mv`, rafraîchie à
00:00 et terminée au plus tard à 00:05. Les deux créneaux 02:00 et 02:20 la satisfont, donc
la dépendance ne contraint pas le choix de la part.

### Créneaux définitifs

```json
{
  "crons": [
    { "path": "/api/admin/cleanup", "schedule": "0 3 1 * *" },
    { "path": "/api/admin/refresh-grid-mv", "schedule": "0 */4 * * *" },
    { "path": "/api/admin/refresh-trending", "schedule": "30 */6 * * *" },
    { "path": "/api/admin/daily-digest", "schedule": "0 6 * * *" },
    { "path": "/api/admin/refresh-repo-stats?part=1", "schedule": "0 2,14 * * *" },
    { "path": "/api/admin/refresh-repo-stats?part=2", "schedule": "20 2,14 * * *" }
  ]
}
```

| Part | Créneau UTC | Vues, dans cet ordre | Durée attendue |
|---|---|---|---|
| 1 | 02:00, 14:00 | `repo_stats_mv`, `repo_power_users_mv` | ≈ 122 s |
| 2 | 02:20, 14:20 | `repo_location_stats_mv`, `repo_company_stats_mv` | ≈ 185 s |

Ordre à l'intérieur de chaque part : la vue qui conditionne le plus la route d'abord
(`repo_stats_mv` décide si la route sert du précalculé ou du live), et dans `part=2` la moins
chère d'abord, pour que la plus chère démarre avec le maximum de budget restant.

Collisions vérifiées, aucune :

- `0 */4 * * *` déclenche à 00, 04, 08, 12, 16, 20. Jamais à 02 ni 14.
- `30 */6 * * *` déclenche à 00:30, 06:30, 12:30, 18:30. Jamais à 02:00, 02:20, 14:00, 14:20.
- `0 6 * * *` à 06:00. Aucun recouvrement.
- `0 3 1 * *` à 03:00 le 1er. `part=2` démarre à 02:20 et est coupée au pire à 02:25.
  35 minutes de marge, y compris le 1er du mois.

### Deux réserves à connaître, pas des bloqueurs

**Chaîne de requête dans `path`.** Vercel accepte une query string dans le champ `path` d'un
cron. Si ça se révélait faux au déploiement, le repli est d'une ligne : faire dériver la part
de l'heure courante côté route (`new Date().getUTCMinutes() < 10 ? 1 : 2`) et pointer les deux
crons sur le même chemin nu. À valider dès le premier déploiement en lisant le champ `part`
renvoyé par le JSON de la route.

**Créneau de 14:00 UTC.** C'est 16:00 CEST, en pleine journée européenne. Les quatre REFRESH
font des balayages complets de `star_event` (2 678 MB de heap) et de `github_user`
(1 949 MB), ce qui évince le local file cache de Neon. Les routes qui lisent `github_user`
en direct (explore, atlas, profil) ressentiront un ralentissement pendant quelques minutes.
C'est le prix des 12 heures de fraîcheur au lieu de 24. Compromis acceptable, mais si le
ralentissement se voit dans les logs, décaler à `0 15,3 * * *` sans rien changer d'autre.

### Effet de bord relevé sur `refresh-mvs.sh` (hors périmètre strict)

L'ADR demande de corriger l'en-tête « 8 materialized views » de `scripts/db/refresh-mvs.sh`.
En le faisant, noter ceci : `language_grid_mv` (vue 7 de `views.sql`, 85 MB) n'apparaît **ni**
dans `MV_NAMES` (`refresh-grid-mv/route.ts:49-58`) **ni** dans `refresh-mvs.sh:37-44`. Son
`last_autoanalyze` en prod date du 2026-06-18, cinq semaines. Elle alimente
`/devs/[language]`. Ce n'est pas le sujet de ce lot, mais un fichier qui annonce « toutes les
vues » et en oublie une est exactement ce qui a produit cette dérive. Ouvrir un ticket séparé.

---

## 4. Feature flag `REPO_STATS_MV_ENABLED`

### Comment `src/env.ts` fonctionne réellement

`src/env.ts` utilise `createEnv` de `@t3-oss/env-nextjs` avec un bloc `server` et un bloc
`client`. Il n'est importé qu'à un seul endroit : `src/lib/db.ts:4`, en import à effet de
bord (`import "@/env";`) pour la validation au démarrage. **Aucun fichier ne lit `env.X`.**
Les consommateurs lisent `process.env.X` directement, par exemple
`src/app/api/badge-update/route.ts:14`.

Déclarer le flag dans `env.ts` a donc deux effets : documenter la variable, et faire échouer
le démarrage si sa forme est invalide. La lecture, elle, passe par `process.env`.

### Diff exact de `src/env.ts`

Dans le bloc `server`, après la ligne 38 (`ORGANIC_SCORE_ENABLED: z.string().optional(),`) :

```ts
    ORGANIC_SCORE_ENABLED: z.string().optional(),
    // Bascule vers les 4 repo_*_mv dans GET /api/stats/[owner]/[repo].
    // Absent ou différent de "true" : chemin live inchangé (comportement d'avant le lot MV).
    REPO_STATS_MV_ENABLED: z.string().optional(),
```

Pas de `experimental__runtimeEnv` à toucher : cette section ne concerne que les variables
`NEXT_PUBLIC_*`.

### Pourquoi `z.string()` et pas une coercition booléenne

`z.coerce.boolean()` applique la conversion de vérité de JavaScript. `Boolean("false")` vaut
`true`. Un flag déclaré ainsi serait **impossible à désactiver** en écrivant
`REPO_STATS_MV_ENABLED=false` dans Vercel, ce qui détruit le mécanisme de rollback immédiat
décrit en section 5 de l'ADR. La forme correcte si on voulait un vrai booléen serait
`z.enum(["true", "false"]).optional().transform((v) => v === "true")`, mais elle diverge des
six autres flags du fichier pour aucun gain. On garde `z.string().optional()` et la
comparaison `=== "true"` au site d'appel, convention déjà appliquée à
`badge-update/route.ts:14`, `organic-score/.../refresh/route.ts:26` et `top-panel.tsx:17`.

### Ligne `.env.example`

Le fichier a une section `# == Feature flags ===` qui commence ligne 62 et se termine ligne 65
sur `NEXT_PUBLIC_ORGANIC_SCORE_ENABLED="false"`. Ajouter à la suite :

```
# Repo stats précalculées : sert GET /api/stats/[owner]/[repo] depuis les 4 repo_*_mv
# au lieu des jointures live. Exige que prisma/sql/views.sql (vues 10 à 13) soit appliqué.
REPO_STATS_MV_ENABLED="false"
```

### Où lire le flag dans la route : à l'intérieur du handler, pas au niveau module

`badge-update/route.ts:14` fige la valeur au chargement du module
(`const ORGANIC_ENABLED = process.env.… === "true"`). Ne pas reproduire ce pattern ici, pour
deux raisons concrètes. En test, `vi.stubEnv` appliqué après l'import n'a aucun effet sur une
constante de module, ce qui obligerait à jouer avec `vi.resetModules()` dans le fichier de
tests. En production, une bascule du flag sur Vercel ne prendrait effet qu'au prochain
démarrage à froid de l'instance, ce qui rend le délai de rollback imprévisible au lieu des
« quelques secondes » annoncées par l'ADR.

```ts
export const GET = async (_req, { params }) => {
  const { owner, repo } = await params;
  // …validation…
  const mvEnabled = process.env.REPO_STATS_MV_ENABLED === "true";
```

Vérifié : les route handlers Next.js App Router lisent `process.env` sans restriction côté
serveur. Toutes les routes du projet le font déjà.

---

## 5. Fraîcheur `computed_at` : `NOW()` contre `clock_timestamp()`

**L'ADR a raison, `NOW()` est le bon choix.** `clock_timestamp()` serait moins juste, pour
trois raisons.

`now()` renvoie l'horodatage de début de transaction et est stable pendant toute sa durée.
`REFRESH MATERIALIZED VIEW` s'exécute dans une transaction unique, donc les 2 500 lignes de
`repo_stats_mv` porteront **la même valeur**. C'est bien la sémantique voulue : « ce cliché a
été pris à telle heure ».

`clock_timestamp()` est volatile et réévalué à chaque ligne. On obtiendrait 2 500 horodatages
différents étalés sur les 60 secondes du REFRESH, aucun ne correspondant à l'instantané MVCC
des données. Pire, ces valeurs seraient **postérieures** au cliché : afficher une fraîcheur
plus optimiste que la réalité est exactement l'erreur à éviter sur un indicateur de fraîcheur.

Écart résiduel avec `now()` : le début de transaction précède de quelques millisecondes la
prise de l'instantané qui sert à lire `star_event`. La fraîcheur est donc sous-estimée de
quelques millisecondes. Sans conséquence pour un affichage à la minute près.

**Précision qui n'est pas dans l'ADR et qui doit y rester attachée.** `REFRESH … CONCURRENTLY`
construit les nouvelles données dans une table temporaire puis les rapproche de la vue
existante par comparaison de **lignes entières**. Comme `computed_at` change à chaque
exécution, la totalité des lignes est vue comme modifiée et réécrite. Sur les 2 500 lignes de
`repo_stats_mv`, le surcoût est inexistant. Sur les 343 775 de `repo_location_stats_mv` ou les
100 597 de `repo_company_stats_mv`, ce serait une réécriture complète à chaque cycle pour rien.
D'où la règle : **`computed_at` sur `repo_stats_mv` uniquement**, jamais sur les trois vues de
dimension. La route n'a de toute façon besoin que d'un seul horodatage.

Type : `NOW()` renvoie un `timestamp with time zone`. Côté route, `computed_at` arrive donc
comme un `Date` et se sérialise par `.toISOString()`, cohérent avec le traitement de
`badgeRow.organicComputedAt` à `route.ts:236`.

---

## 6. `REFRESH CONCURRENTLY` sur une vue vide

### CORRECTION 4 : la prémisse est inexacte

L'énoncé « `REFRESH … CONCURRENTLY` échoue si la vue n'a jamais été peuplée » mélange deux
notions. Postgres refuse `CONCURRENTLY` quand la vue est **non peuplée**, c'est-à-dire quand
`pg_class.relispopulated` vaut `false`. Une vue peuplée qui contient **zéro ligne** se
rafraîchit en `CONCURRENTLY` sans problème.

`relispopulated` ne passe à `false` que dans deux cas : `CREATE MATERIALIZED VIEW … WITH NO
DATA`, ou `REFRESH MATERIALIZED VIEW … WITH NO DATA`.

### Comment les 8 vues existantes gèrent le problème : elles ne le rencontrent jamais

Vérifié sur Neon prod le 2026-07-23 :

```sql
SELECT relname, relispopulated FROM pg_class WHERE relkind = 'm';
```

Les neuf vues renvoient `relispopulated = t`. Aucune occurrence de `WITH NO DATA` dans
`prisma/sql/views.sql` ni dans les sept fichiers de `scripts/db/sql/`. Toutes les créations
utilisent la forme `CREATE MATERIALIZED VIEW … AS SELECT`, qui peuple à la création. Le
premier `REFRESH CONCURRENTLY` de `/api/admin/refresh-grid-mv` trouve donc toujours une vue
peuplée. Il n'y a pas de traitement particulier dans `refresh-grid-mv/route.ts` parce qu'il
n'y en a jamais eu besoin.

Le SQL de la section 2 respecte cette convention, donc le problème ne se pose pas non plus
pour les quatre nouvelles vues.

### Ce que la nouvelle route doit quand même faire

Ajouter le garde-fou malgré tout. Il coûte quatre lignes et transforme une erreur SQLSTATE
`55000` opaque en premier rafraîchissement qui se répare tout seul. Le cas de figure qui le
justifie concrètement : quelqu'un cherchera à éviter les 306 secondes de `pnpm setup:mvs` en
créant les vues avec `WITH NO DATA` sur une base locale, et se retrouvera avec un cron cassé
en silence.

```ts
const isPopulated = async (client: PoolClient, name: string): Promise<boolean> => {
  const { rows } = await client.query<{ relispopulated: boolean }>(
    "SELECT relispopulated FROM pg_class WHERE relname = $1 AND relkind = 'm'",
    [name],
  );
  return rows[0]?.relispopulated ?? false;
};

// dans la boucle :
const concurrently = (await isPopulated(client, name)) ? "CONCURRENTLY " : "";
await client.query(`REFRESH MATERIALIZED VIEW ${concurrently}${name}`);
```

`name` vient d'un tableau littéral `as const` interne au fichier, jamais de l'entrée
utilisateur. Pas de risque d'injection par interpolation, et c'est déjà ce que fait
`refresh-grid-mv/route.ts:78`.

Le repli non concurrent prend un `AccessExclusiveLock` et bloque les lectures de la vue
pendant sa durée. Sur un premier rafraîchissement, personne ne lit encore la vue. Acceptable.

---

## 7. Pièges Neon : conformité du plan

| Contrainte | Vérification | Statut |
|---|---|---|
| Jamais `CREATE INDEX CONCURRENTLY` | Les 7 `CREATE INDEX` de la section 2 sont tous sans `CONCURRENTLY` | conforme |
| `SET statement_timeout = 0` en tête de DDL | `views.sql:10` couvre le fichier entier (exécution en une seule requête par `setup-mvs.ts:29`). `create-repo-stats-mvs.sql` porte le sien | conforme |
| `prisma db push`, jamais `migrate dev` | Aucun modèle Prisma ajouté, aucune migration. Les MV ne sont pas gérées par Prisma | sans objet |
| Pool SSL gaté sur `NODE_ENV` | La nouvelle route copie `refresh-grid-mv/route.ts:66-69` : `ssl: process.env.NODE_ENV === "production" ? true : undefined` | à respecter |
| Adaptateur HTTP Neon et `SET` | `SET statement_timeout = 0` ne persiste pas via l'adaptateur HTTP (chaque requête est une requête indépendante). D'où l'usage de `pg` en TCP dans la route de refresh, comme documenté `refresh-grid-mv/route.ts:11-14` | à respecter |
| Lecture dans la route `/api/stats` | Passe par `prisma.$queryRaw` (adaptateur HTTP), c'est correct : ce sont des index scans de moins de 20 ms, aucun besoin de lever le timeout | conforme |

Un point non listé par le lead mais qui relève de la même famille : `views.sql` s'exécute en
une transaction unique de plus de 5 minutes après ajout des quatre vues. Neon ne pose pas de
limite de durée de transaction, mais un `pnpm db:setup` interrompu ne laissera aucune vue
créée du tout. Le documenter dans l'en-tête de `views.sql`, c'est le rôle du fichier dédié de
`scripts/db/sql/` de permettre une création ciblée.

---

## 8. Fichiers à toucher, liste exhaustive

### 8.1 SQL

| Fichier | Action |
|---|---|
| `prisma/sql/views.sql` | ajouter les sections 10 à 13 (SQL de la §2) à la fin. Mettre à jour l'en-tête du fichier pour annoncer 13 vues |
| `scripts/db/sql/create-repo-stats-mvs.sql` | **nouveau**. `SET statement_timeout = 0;` puis le même SQL. En-tête sur le modèle de `create-trending-mv.sql` |
| `scripts/db/refresh-mvs.sh` | en-tête ligne 2 : « 8 materialized views » devient 12 (les 8 actuelles plus les 4 nouvelles, `language_grid_mv` restant hors liste, cf. §3). Ajouter les 4 `REFRESH MATERIALIZED VIEW CONCURRENTLY` dans le bloc `psql` lignes 37-44, après `power_users_mv` pour `repo_power_users_mv` |

`ANALYZE star_event` est déjà présent en tête du bloc `psql` (`refresh-mvs.sh:36`). L'étape 0
de l'ADR le demandait : c'est fait, rien à ajouter de ce côté. Reste à jouer
`scripts/db/sql/create-star-event-owner-repo-stats.sql` une fois en prod, il n'a jamais tourné.

### 8.2 Route API de lecture

`src/app/api/stats/[owner]/[repo]/route.ts`

1. Type `RepoStats` : ajouter `source?` et `computedAt?` (diff exact en §1).
2. Dans le handler, après `normalizeOwnerRepo`, lire `process.env.REPO_STATS_MV_ENABLED === "true"`.
3. Si le flag est actif, une seule requête sur `repo_stats_mv` **avant** le bloc totals
   actuel. Ligne trouvée : alimenter `total`, `mappedCount`, `avgFollowers`,
   `enrichedUserCount`, `botCount`, `computedAt`, puis lire les trois vues de dimension à la
   place des trois requêtes live de `route.ts:156-198`. Aucune ligne : ne rien changer, on
   tombe dans le code existant.
4. Si le flag est inactif : ne pas émettre la requête sur `repo_stats_mv`. Contrainte de test,
   cf. §1.
5. `Cache-Control` selon la provenance :

| Cas | En-tête |
|---|---|
| `source === "precomputed"` | `public, s-maxage=900, stale-while-revalidate=3600` |
| `source === "live"`, réponse complète | `public, s-maxage=300, stale-while-revalidate=600` (inchangé, `route.ts:287`) |
| `isPartial` | `public, s-maxage=30, stale-while-revalidate=60` (inchangé, `route.ts:286`) |

Ce qui **ne change pas** : `parseLocation()` sur les lignes de location (`route.ts:203-208`),
le calcul de `countryCount`/`cityCount`, la relecture de `name`/`followers` des power users
par clé primaire (`route.ts:214-219`), le bloc `organic` issu de `badge_cache`
(`route.ts:232-248`), le repli `badgeRow` (`route.ts:129-133`). Les vues rendent exactement
les mêmes colonnes que les requêtes qu'elles remplacent, c'est ce qui garantit zéro dérive de
comportement.

### 8.3 Route API de rafraîchissement

`src/app/api/admin/refresh-repo-stats/route.ts` (**nouveau**). Copier
`src/app/api/admin/refresh-grid-mv/route.ts` et adapter :

- `export const maxDuration = 300;`
- `POST` gardé par `requireAdminAuth`, `GET` gardé par `safeEqual(authHeader, "Bearer " + CRON_SECRET)` avec `404` si `CRON_SECRET` est absent. Identique aux lignes 25-47.
- Lecture de `?part=` : `1` ou `2`, défaut `1` sur valeur absente ou invalide.
- Listes : `part=1` → `["repo_stats_mv", "repo_power_users_mv"]`, `part=2` → `["repo_location_stats_mv", "repo_company_stats_mv"]`.
- `Pool` de `pg`, `ssl` gaté sur `NODE_ENV`, `SET statement_timeout = 0` en premier, boucle séquentielle, `try/catch` par vue avec `logError` et `sanitizeError`.
- Garde `relispopulated` avant chaque REFRESH (§6).
- Garde de délai avant de démarrer chaque vue : `if (Date.now() - start > 240_000) { skipped.push(name); continue; }`. Même idiome qu'à `refresh-trending/route.ts:74-81`. Sans ça, une coupure Vercel à 300 s fait disparaître la réponse JSON et donc toute observabilité.
- Réponse : `{ ok, part, durationMs, results: [{ mv, durationMs, error? }], skipped }`.
- Pas de `revalidateTag` : rien ne met en cache ces vues côté Next, la route `/api/stats` sert via `Cache-Control` et `page.tsx` via `cacheLife`.

### 8.4 Rendu serveur

`src/app/[owner]/[repo]/page.tsx:38-59`. La fonction `fetchStats` ajuste déjà `cacheLife` sur
`isPartial` (ligne 54). Ajouter la branche symétrique :

```ts
if (stats.isPartial) cacheLife("seconds");
else if (stats.source === "precomputed") cacheLife("hours");
```

Attention à l'ordre : `cacheLife` conserve le minimum entre les appels d'un même scope (c'est
ce qu'explique le commentaire lignes 48-53). L'appel `cacheLife("minutes")` de la ligne 41
plafonne donc déjà l'entrée, et `cacheLife("hours")` **ne l'allongera pas**. Pour que le
précalculé bénéficie réellement de sa durée de vie, il faut remonter le défaut de la ligne 41
à `cacheLife("hours")` et redescendre à `"minutes"` dans la branche `live`. À faire, ou à
laisser tel quel en assumant que le gain se limite au CDN. L'ADR ne tranche pas ce point
(« complication non justifiée », section 3), donc : **laisser `page.tsx` inchangé au premier
jet**, et ne revenir dessus que si le gain CDN se révèle insuffisant. Décision à confirmer par
le lead.

### 8.5 Interface (optionnel, hors chemin critique)

`src/components/map/stats-modal.tsx` peut afficher `displayStats.computedAt` pour rendre le
compromis de fraîcheur lisible, comme le suggère la section 6 de l'ADR. Le prop est déjà de
type `RepoStats` (`stats-modal.tsx:18`), aucune plomberie à ajouter. Ne pas confondre avec
`displayStats.organic?.computedAt`, qui date le score organique.

### 8.6 Tests

`src/app/api/stats/[owner]/[repo]/__tests__/route.test.ts`

Ne modifier **aucun** des 14 tests existants. Ils doivent passer tels quels, flag absent.
C'est le contrôle de non-régression. Ajouter un `describe("repo_stats_mv path")` avec
`vi.stubEnv("REPO_STATS_MV_ENABLED", "true")` en `beforeEach` et `vi.unstubAllEnvs()` en
`afterEach` (le projet impose `pool: "forks"`, mais les env stubs ne sont pas isolés entre
tests d'un même fichier). Trois cas demandés par l'ADR, plus deux qui découlent de cet audit :

1. Ligne présente dans `repo_stats_mv` : réponse `source: "precomputed"`, `computedAt` rempli, `Cache-Control` à `s-maxage=900`, et **zéro** requête live émise.
2. Aucune ligne dans `repo_stats_mv`, live qui répond : `source: "live"`, `s-maxage=300`.
3. Aucune ligne, live en timeout : `isPartial: true`, `s-maxage=30`, `source` absent ou `"live"`.
4. Flag absent : la séquence de `$queryRaw` est identique à celle d'aujourd'hui (assertion sur `mockQueryRaw.mock.calls.length`).
5. `computedAt` sérialisé en ISO 8601 depuis un `Date` renvoyé par `$queryRaw`.

### 8.7 Documentation

- `CLAUDE.md`, section « Known Gotchas » : « 7 MVs » puis « 9 MVs » selon les endroits, à porter à 13 et à mentionner que `repo_power_users_mv` doit être rafraîchie après `power_users_mv`.
- `.claude/rules/known-gotchas.md`, section « 9 Materialized Views » : même mise à jour, plus l'ordre de dépendance.
- `.env.example` : ligne du flag (§4).
- `docs/ARCHITECTURE.md` : contrat de `GET /api/stats/[owner]/[repo]` avec les champs `source` et `computedAt`.

---

## 9. Ordre d'exécution et points de vérification

L'ordre est contraint : la base migre avant que le code n'arrive en production, pour la même
raison que le cron trending (`.claude/rules/known-gotchas.md`).

| Étape | Action | Vérification |
|---|---|---|
| 1 | Jouer `scripts/db/sql/create-star-event-owner-repo-stats.sql` en prod sur l'endpoint direct | `SELECT last_analyze, n_mod_since_analyze FROM pg_stat_user_tables WHERE relname='star_event'` : `last_analyze` du jour, `n_mod_since_analyze` proche de 0 |
| 2 | Écrire le SQL des 4 vues dans `views.sql` et `create-repo-stats-mvs.sql` | `rtk git diff`, relecture |
| 3 | Jouer `create-repo-stats-mvs.sql` en prod (endpoint direct, ≈ 306 s) | les 4 `COUNT(*)` à environ 2 500 / 344 000 / 101 000 / 47 000. Écart marqué = jointure ou filtre erroné |
| 4 | Contrôle de justesse **avant** de toucher la route | sur `emilkowalski/sonner` (12 386 lignes) et un repo moyen : `total`, `mapped`, `avg_followers` et le top 10 des locations doivent coïncider entre la vue et la requête live |
| 5 | Code : route de lecture, route de refresh, env.ts, .env.example, vercel.json | `rtk tsc` à 0 erreur, `pnpm vitest run src/app/api/stats` vert **sans modifier les tests existants** |
| 6 | Déployer avec `REPO_STATS_MV_ENABLED` absent | comportement identique à aujourd'hui, timeouts compris. Contrôle par `vercel-logs.sh --since 1h` |
| 7 | Déclencher `/api/admin/refresh-repo-stats?part=1` et `?part=2` à la main via `POST` + auth admin | JSON avec `durationMs` par vue, aucun `error`, `skipped` vide |
| 8 | Passer `REPO_STATS_MV_ENABLED=true` sur Vercel | `kamranahmedse/developer-roadmap` répond avec `topCountries` non vide, `isPartial` absent, `source: "precomputed"` |
| 9 | Surveiller 24 h | plus de `[stats/totals timeout]` ni `[stats/power-users timeout]` hors repos fraîchement indexés |

Seuils d'alerte, repris de la section 7 de l'ADR : `durationMs` au-delà de 240 000 ms sur une
seule vue, ou écart supérieur à 5 % entre `repo_stats_mv.total` et le `COUNT(*)` live sur un
échantillon.

---

## 10. Ce que cet audit n'a pas pu mesurer

Honnêteté sur les limites, pour que personne ne prenne ces chiffres pour des certitudes.

Les durées de construction des quatre vues (59,6 / 39,7 / 145,2 / 61,7 secondes) viennent de
l'ADR et n'ont pas été refaites ici. Les relancer coûterait 306 secondes de compute prod et
éviscérerait le cache Neon. Ce qui a été refait, c'est la **planification** des requêtes via
`EXPLAIN` sans `ANALYZE` : les trois plans testés sont conformes à ce que décrit l'ADR, ce qui
rend les durées crédibles sans les confirmer. Le rééquilibrage des parts en §3 est justement
conçu pour absorber une erreur de mesure sur `repo_company_stats_mv`, la plus atypique des
quatre.

La durée réelle de `/api/admin/refresh-grid-mv` reste inconnue. `pg_stat_statements` n'est pas
installé sur la base de prod. L'argument de non-collision ne repose donc pas sur une mesure
mais sur `maxDuration = 300`, qui est une borne dure imposée par Vercel, pas une estimation.

Le nombre de paires `(owner, repo)` distinctes dans `star_event` (2 517 selon l'ADR) n'a pas
été recompté : la requête balaye 33 millions de lignes. `badge_cache` en compte 2 669, ce qui
encadre l'ordre de grandeur.
