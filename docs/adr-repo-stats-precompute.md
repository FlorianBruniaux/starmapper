# ADR: précalcul des statistiques par repo

**Date**: 2026-07-23
**Statut**: proposé
**Portée**: `GET /api/stats/[owner]/[repo]`, pipeline de rafraîchissement des vues matérialisées
**Diagnostic amont**: `research-stats-timeouts.md`

---

## 1. Contexte chiffré

La route `src/app/api/stats/[owner]/[repo]/route.ts` construit sa réponse à partir de quatre
requêtes qui joignent toutes `star_event` et `github_user`. Sur Neon prod, `statement_timeout`
vaut 10s. Trente occurrences de `[stats/totals timeout]` ont été relevées sur une fenêtre de
deux heures, toutes sur des repos au-dessus de 60 000 stars.

### Volumétrie réelle (catalogue Neon, 2026-07-23)

| Objet | Lignes | Heap | Total avec index |
|---|---|---|---|
| `star_event` | 30,7 M (estim.), 33,0 M réelles | 2 678 MB | 13 GB |
| `github_user` | 7 258 387 | 1 949 MB | 4 863 MB |
| `power_users_mv` | 3 606 329 | 203 MB | 615 MB |
| `badge_cache` | 2 669 | 912 kB | 1 536 kB |

Paramètres serveur mesurés : `work_mem = 4MB`, `max_parallel_workers_per_gather = 2`,
`statement_timeout = 10s`.

Distribution des repos indexés (`badge_cache`) : 2 669 au total, 529 au-dessus de 10 000 stars,
419 au-dessus de 25 000, 305 au-dessus de 60 000. Sur les sept derniers jours, 390 repos ont vu
leur `badge_cache` réécrit, dont 326 au-dessus de 25 000 stars. Le pipeline `make auto-index`
et le cron de rescan trending touchent donc en priorité la population qui casse.

`star_event` contient environ 2 517 paires `(owner, repo)` distinctes (compté par les agrégats
partiels du plan parallèle), pour 33 millions de lignes. Le rapport est de 13 000 lignes par
repo en moyenne, avec une queue très étalée : `kamranahmedse/developer-roadmap` pèse 361 334
stars, `rtk-ai/rtk` 60 418 `star_event`.

### Le vrai problème n'est pas la lenteur, c'est la variance

Mesures de la requête totals sur l'endpoint direct, cache Neon tiède après mes scans complets :

| Repo | Lignes jointes | Durée |
|---|---|---|
| `emilkowalski/sonner` | 12 386 | 5 106 ms |
| `lllyasviel/stable-diffusion-webui-forge` | 12 589 | 3 866 ms |
| `commaai/openpilot` | 63 182 | 9 940 ms |
| `rtk-ai/rtk` | 60 418 | 4 056 ms |

`rtk-ai/rtk` tourne en 4s ici alors que le même repo dépassait les 10s en production quelques
heures plus tôt (mesure du diagnostic amont). L'écart ne vient pas du plan, il vient de l'état
du local file cache de Neon : la jointure sonde `github_user_pkey` sur une table de 1 949 MB,
et selon que les pages sont chaudes ou froides le facteur est de 2 à 4. Un repo de 12 000
lignes consomme déjà la moitié du budget de 10s. Il n'existe donc pas de seuil de taille stable
en dessous duquel le chemin live serait sûr.

Cette variance disqualifie toute stratégie du type « essayer en live, se rabattre en cas de
timeout » : le repli coûte 10 secondes de latence à l'utilisateur avant de produire quoi que
ce soit, et le résultat dégradé part ensuite dans le CDN pour 5 minutes
(`s-maxage=300`, `route.ts:259`).

### Ce que la correction des statistiques du planner ne règle pas

`scripts/db/sql/create-star-event-owner-repo-stats.sql` existe déjà mais n'est câblé ni dans
`prisma/sql/views.sql` ni dans aucun cron. Le lancer corrigera l'estimation de cardinalité
(9 318 estimées contre 60 418 réelles sur `rtk-ai/rtk`) et débloquera très probablement la
famille `power-users`. Il ne change rien pour `developer-roadmap` : 361 000 accès aléatoires
dans une table de 7,2 M lignes sur stockage distant ne tiennent pas dans 10s, quel que soit
le plan retenu. Cette correction est un prérequis, pas la solution.

---

## 2. Options évaluées

### Option 1 : vues matérialisées par repo

Quatre vues, une par bloc de la réponse. J'ai mesuré chaque requête de construction en prod
avec `EXPLAIN (ANALYZE, BUFFERS)` et `statement_timeout = 0`.

| Vue | Contenu | Lignes produites | Durée mesurée |
|---|---|---|---|
| `repo_stats_mv` | total, mapped, avg_followers, enriched, bots | 2 517 | 59 614 ms |
| `repo_location_stats_mv` | top 200 locations brutes par repo | 343 775 | 39 671 ms |
| `repo_company_stats_mv` | top 50 companies par repo | 100 597 | 145 232 ms |
| `repo_power_users_mv` | top 20 power users par repo | 47 025 | 61 654 ms |

Total à froid : environ 306 secondes pour les quatre. Volume stocké : 494 000 lignes, de
l'ordre de 85 MB index compris, à comparer aux 13 GB de `star_event`.

Le plan retenu pour l'agrégat scalaire est un `Parallel Hash Join` avec deux workers, deux
`Seq Scan` complets, 128 batches de hachage et 2,0 GB de fichiers temporaires (conséquence
directe de `work_mem = 4MB`). Aucun nested loop, aucune sonde aléatoire : c'est exactement le
régime pour lequel le moteur est bon, et c'est ce qui explique qu'un balayage de 33 millions
de lignes coûte moins cher que 361 000 sondes ponctuelles.

Lecture côté route : quatre index scans sur des vues de 2 500 à 344 000 lignes, moins de 20 ms
cumulés. La latence devient identique pour `femboyisp/yip` (29 stars) et pour
`developer-roadmap` (361 334).

Point à trancher sur la granularité : garder la `location` **brute** plutôt que
`countryNormalized`. Un échantillon `TABLESAMPLE SYSTEM (2)` de `github_user` donne 45 823
lignes avec `location` renseignée contre 17 010 avec `countryNormalized`. Passer par la colonne
normalisée ferait perdre environ 63 % du signal géographique. En agrégeant sur la chaîne brute,
la vue reproduit à l'identique la requête actuelle (`route.ts:155-164`, `GROUP BY u.location`
puis `LIMIT 200`) et le `parseLocation()` côté JS reste inchangé. Zéro dérive de comportement.

Limite connue : un repo scanné pour la première fois n'a pas de ligne dans les vues tant que le
cron n'a pas tourné.

### Option 2 : dénormalisation sur `star_event`

Copier `lat`, `lng`, `followers`, `dataVersion`, `following`, `publicRepos` sur chaque ligne de
`star_event` supprime la jointure. Le chiffrage est défavorable sur trois axes.

Taille : six colonnes à 32 octets par ligne sur 33 millions de lignes ajoutent 1,06 GB au heap,
qui passe de 2 678 MB à environ 3,7 GB (+40 %). Pour que la lecture par repo soit rapide, il
faut en plus un index couvrant `(owner, repo) INCLUDE (lat, lng, followers, ...)`, soit environ
2 GB supplémentaires sur une table qui porte déjà 10,3 GB d'index.

Backfill : un `UPDATE` de 33 millions de lignes réécrit chaque version de ligne (MVCC). Pic de
stockage autour de 7,4 GB avant récupération par autovacuum, plusieurs GB de WAL, et un
traitement par lots étalé sur des heures pour ne pas saturer le compute Neon.

Dérive : `github_user` est réécrit en continu par les backfills (géocodage, enrichissement,
langages). Chaque mise à jour rend les copies obsolètes et impose un job de resynchronisation
qui est lui-même un `UPDATE` de 33 millions de lignes. C'est le coût récurrent qui condamne
l'option, pas le coût initial.

À porter au crédit de l'option : `src/lib/user-cache.ts` dispose déjà des valeurs au moment de
l'écriture, la double écriture y serait quasi gratuite. Cela ne compense pas les 33 millions de
lignes existantes ni la dérive.

### Option 3 : extension de `badge_cache`

`badge_cache` est déjà lu en premier (`route.ts:68`) et sert de repli. L'alimenter en fin de
chunk loop via `POST /api/badge-update` paraît naturel. Deux blocages.

Calcul côté serveur : impossible. `badge-update/route.ts` exécute déjà une jointure
`github_user × star_event` filtrée sur `(owner, repo)` pour l'échantillon du score organique.
C'est la même forme de requête que celle qui échoue. Sur un repo à 361 000 stars elle dépasse
les 10s et la route renvoie 500. Ajouter cinq agrégats de plus au même endroit aggrave un
problème existant au lieu de le résoudre.

Calcul côté client : techniquement possible, le navigateur détient déjà `login`, `lat`, `lng`,
`followers`, `location` et `company` accumulés par le chunk loop. Mais `powerStargazers` exige
une connaissance transverse aux repos (`power_users_mv`, 3,6 M lignes) que le client n'a pas,
et la mise à jour ne se produit que lorsqu'un humain lance un scan complet dans un navigateur.
Les repos alimentés par `make auto-index` resteraient sans données. S'ajoute une surface de
falsification : des agrégats calculés par le client et affichés comme statistiques, là où le
contrôle de plausibilité actuel ne porte que sur `totalCount` (ratio 0,5 à 1,5).

L'option couvre donc au mieux `avgFollowers`, `botCount`, `topCountries`, `topCities` et
`topCompanies`, pour un sous-ensemble des repos, et jamais `powerStargazers`.

### Option 4 : table classique alimentée par upsert

Variante de l'option 1 avec une table Prisma plutôt qu'une vue matérialisée. Avantage réel :
un recalcul ciblé sur un seul repo devient possible juste après un scan, ce qui supprime le
trou de fraîcheur. Coût : un modèle Prisma de plus, une logique d'upsert et de purge à écrire,
une gestion d'atomicité à la main là où `REFRESH MATERIALIZED VIEW CONCURRENTLY` la fournit,
et une divergence par rapport aux neuf vues existantes et au pipeline `pnpm db:setup`.

Écartée pour l'instant, mais le chemin de migration reste ouvert : les colonnes sont
identiques, passer de vue à table plus tard ne casse pas la route.

### Synthèse

| Critère | Option 1 (MV) | Option 2 (dénorm.) | Option 3 (badge_cache) | Option 4 (table) |
|---|---|---|---|---|
| Latence lecture `developer-roadmap` | < 20 ms | < 1 s | < 5 ms | < 20 ms |
| Couvre `powerStargazers` | oui | non | non | oui |
| Stockage ajouté | ~85 MB | ~3 GB | ~5 MB | ~85 MB |
| Coût récurrent | 306 s/refresh | resync 33 M lignes | nul | 306 s/refresh |
| Fraîcheur | cron | temps réel | fin de scan | cron + ciblé |
| Alourdit `/api/chunk` | non | marginalement | non | non |
| Cohérence avec l'existant | forte | faible | moyenne | moyenne |

---

## 3. Décision

**Option 1.** Quatre vues matérialisées, lues en priorité par la route, avec le chemin live
conservé uniquement pour les repos absents des vues.

Trois raisons.

La première est le coût comparé, et il est contre-intuitif : agréger 33 millions de lignes par
balayage parallèle coûte 60 secondes, alors que sonder 361 000 lignes une par une ne tient pas
dans 10. Le précalcul global n'est pas un pis-aller, c'est le régime d'exécution pour lequel
Postgres est efficace ici.

La deuxième est la variance mesurée. Tant que la route dépend d'une jointure à la demande, sa
latence dépend du contenu du cache Neon, donc du trafic des minutes précédentes. Un repo à
12 000 lignes consomme déjà 4 à 5 secondes. Aucun seuil de taille ne sépare proprement le sûr
du dangereux, et un gate calibré aujourd'hui devra l'être à nouveau après chaque évolution du
volume. La vue matérialisée supprime la question.

La troisième est l'alignement avec le projet : neuf vues existent, `pnpm db:setup` les crée,
`/api/admin/refresh-grid-mv` les rafraîchit avec un pattern déjà éprouvé (session `pg` en TCP,
`SET statement_timeout = 0`, boucle séquentielle, try/catch par vue). Rien de nouveau à
inventer côté opérationnel.

### Routage dans la route

Ordre de résolution, pour chaque bloc de la réponse :

1. Ligne présente dans `repo_stats_mv` : servir les valeurs précalculées, exposer
   `source: "precomputed"` et `computedAt`.
2. Aucune ligne : exécuter la requête live actuelle, avec son `catch` de timeout inchangé,
   et exposer `source: "live"`.
3. Live en échec et pas de vue : repli `badge_cache` comme aujourd'hui, `isPartial: true`.

Le cas 2 concerne les repos indexés depuis le dernier refresh. Sur la population actuelle,
cela représente au plus quelques dizaines de repos à un instant donné, majoritairement petits,
pour lesquels le chemin live fonctionne.

### Politique de cache

Le défaut actuel à corriger : un seul timeout écrit une réponse vide dans le CDN pour cinq
minutes, et cela frappe précisément les repos les plus visités.

| `source` | `Cache-Control` | Justification |
|---|---|---|
| `precomputed` | `public, s-maxage=900, stale-while-revalidate=3600` | la donnée ne bouge qu'au cron |
| `live` | `public, s-maxage=300, stale-while-revalidate=600` | inchangé |
| réponse `isPartial` | `public, s-maxage=30, stale-while-revalidate=60` | un nouvel essai doit pouvoir réussir vite |

`page.tsx:41` conserve `cacheLife("minutes")`. Ce niveau ne distingue pas les trois cas et le
faire varier demanderait un profil de cache par branche, complication non justifiée tant que
les réponses `isPartial` deviennent rares.

---

## 4. Plan de migration

Chaque étape est vérifiable indépendamment. L'ordre importe : la base migre avant que le code
ne parte en production, pour la même raison que le cron trending
(`.claude/rules/known-gotchas.md`, section « Cron trending »).

### Étape 0 : prérequis statistiques

Câbler `scripts/db/sql/create-star-event-owner-repo-stats.sql` (déjà écrit, jamais exécuté en
routine) et lancer `ANALYZE star_event`. Le dernier `ANALYZE` date du 2026-07-01 avec 2,6 M de
modifications non analysées depuis. Sans cela, les requêtes de construction des vues partent
elles aussi sur de mauvaises estimations. Ajouter `ANALYZE star_event` en fin de
`scripts/db/refresh-mvs.sh` pour que la dérive ne se reforme pas.

Vérification : `SELECT last_analyze, n_mod_since_analyze FROM pg_stat_user_tables WHERE relname = 'star_event'`.

### Étape 1 : définition SQL des quatre vues

Ajouter les définitions à `prisma/sql/views.sql`, en suivant le format des vues 1 à 9
(`SET statement_timeout = 0;` en tête du fichier, `CREATE MATERIALIZED VIEW IF NOT EXISTS`,
index unique pour rendre `REFRESH CONCURRENTLY` possible, jamais `CONCURRENTLY` sur un
`CREATE INDEX`).

Formes retenues, avec les index uniques nécessaires :

| Vue | Clé unique | Index secondaire |
|---|---|---|
| `repo_stats_mv` | `(owner, repo)` | aucun |
| `repo_location_stats_mv` | `(owner, repo, location)` | `(owner, repo, cnt DESC)` |
| `repo_company_stats_mv` | `(owner, repo, company)` | `(owner, repo, cnt DESC)` |
| `repo_power_users_mv` | `(owner, repo, login)` | `(owner, repo, cnt DESC)` |

`repo_stats_mv` porte une colonne `computed_at` alimentée par `NOW()`, évaluée à chaque
`REFRESH`, qui sert à afficher la fraîcheur côté interface.

Les vues de dimension appliquent un `ROW_NUMBER() OVER (PARTITION BY owner, repo ORDER BY cnt DESC)`
avec les mêmes bornes que la route actuelle : 200 locations, 50 companies, 20 power users.
Conserver ces bornes exactes évite tout écart de résultat.

Contrainte à respecter : `repo_power_users_mv` dépend de `power_users_mv`. Elle doit être
rafraîchie après, jamais avant.

### Étape 2 : création en production

Passer par l'endpoint direct (sans `-pooler`), comme `scripts/db/refresh-mvs.sh`. Compter
environ 306 secondes de construction à froid.

Vérification : les quatre `COUNT(*)` doivent être de l'ordre de 2 500 / 344 000 / 101 000 /
47 000. Un écart important signale une jointure ou un filtre erroné.

Contrôle de non-régression obligatoire avant de toucher la route : comparer, sur trois repos de
tailles différentes, la sortie des vues et celle des requêtes live actuelles. Prendre un petit
repo qui répond en live (`emilkowalski/sonner`), un moyen, et vérifier que `total`, `mapped`,
`avg_followers` et le top 10 des locations coïncident.

### Étape 3 : lecture dans la route

Modifier `src/app/api/stats/[owner]/[repo]/route.ts` derrière un drapeau
`REPO_STATS_MV_ENABLED`. Tant qu'il est absent ou à `false`, le comportement actuel est
conservé à l'identique. Ajouter `source` et `computedAt` au type `RepoStats` exporté, et
répercuter dans les consommateurs client (`grep` sur `RepoStats` avant de fermer, cf.
`.claude/rules/universal-rules.md`, règle 2).

Les tests existants sont dans `src/app/api/stats/[owner]/[repo]/__tests__/route.test.ts`.
Trois cas à ajouter : vue présente, vue absente avec live qui répond, vue absente avec live en
timeout.

### Étape 4 : rafraîchissement automatique

Ne pas ajouter les quatre vues à `/api/admin/refresh-grid-mv` : cette route a
`maxDuration = 300` et rafraîchit déjà huit vues. Les 306 secondes mesurées la feraient sauter.

Créer `/api/admin/refresh-repo-stats` sur le modèle exact de `refresh-grid-mv/route.ts`
(pool `pg` en TCP, gate SSL sur `NODE_ENV`, `SET statement_timeout = 0`, boucle séquentielle,
try/catch par vue, `maxDuration = 300`). Chaque `REFRESH` étant sa propre transaction, une
coupure de la fonction ne perd que la vue en cours.

Découper en deux créneaux pour rester sous les 300 secondes avec de la marge :

| Cron | Créneau | Vues |
|---|---|---|
| `/api/admin/refresh-repo-stats?part=1` | `0 2,14 * * *` | `repo_stats_mv`, `repo_location_stats_mv` (≈ 100 s) |
| `/api/admin/refresh-repo-stats?part=2` | `20 2,14 * * *` | `repo_company_stats_mv`, `repo_power_users_mv` (≈ 207 s) |

Le créneau de 02:20 laisse `power_users_mv` se terminer d'abord : le cron
`/api/admin/refresh-grid-mv` tourne à `0 */4 * * *`, donc à 00:00 pour le passage précédent.

`scripts/db/refresh-mvs.sh` reste le chemin manuel sans limite de durée, utilisé par
`make maintenance`. Son en-tête annonce « 8 materialized views » alors qu'il y en aura douze :
à corriger dans le même commit.

### Étape 5 : activation

Passer `REPO_STATS_MV_ENABLED=true` sur Vercel. Surveiller pendant 24 heures.

---

## 5. Rollback

Le changement est additif à tous les niveaux, ce qui donne trois crans de retour arrière.

Retour immédiat, sans déploiement : passer `REPO_STATS_MV_ENABLED` à `false`. La route
retrouve le comportement d'aujourd'hui, timeouts compris. Effet en quelques secondes, le temps
de la propagation d'environnement et d'un redéploiement des fonctions.

Retour du code : `git revert` du commit de la route. Les vues restent en base, inutilisées, à
85 MB. Aucune urgence à les supprimer.

Retour de la base : `DROP MATERIALIZED VIEW IF EXISTS` sur les quatre, plus retrait des
définitions de `prisma/sql/views.sql` et des entrées de `vercel.json`. À ne faire que si le
coût de rafraîchissement se révèle ingérable, ce que les mesures ne laissent pas prévoir.

Aucune migration de schéma Prisma n'est impliquée, donc aucun `prisma db push` à défaire, et
aucune donnée existante n'est modifiée : `star_event`, `github_user` et `badge_cache` ne sont
lus que par les vues.

Signal de déclenchement du rollback : un refresh qui dépasse 280 secondes de façon répétée sur
`part=2`, ou un écart supérieur à 5 % entre `repo_stats_mv.total` et le `COUNT(*)` live sur un
échantillon de repos.

---

## 6. Ce qu'on accepte de perdre

**Fraîcheur, jusqu'à douze heures.** Avec deux refresh par jour, un repo rescanné à 03:00 verra
ses statistiques mises à jour à 14:00. Sur la population concernée le compromis est franchement
favorable : les 305 repos au-dessus de 60 000 stars n'affichent aujourd'hui aucun pays, aucune
ville, aucune entreprise et aucun power user. Passer d'un tableau vide à une donnée vieille de
quelques heures est un gain net. Pour les petits repos, en revanche, c'est une vraie
régression : ils obtenaient jusqu'ici une donnée à la seconde. L'affichage de `computedAt` dans
l'interface rend le compromis lisible plutôt que silencieux.

**Le premier scan d'un gros repo.** Un repo de plus de 60 000 stars indexé pour la première
fois n'aura pas de ligne dans les vues, tombera sur le chemin live, et restera dégradé jusqu'au
refresh suivant. C'est exactement la situation d'aujourd'hui, sans amélioration ni
détérioration. Si ce cas devient gênant, l'option 4 (table plutôt que vue, avec recalcul ciblé
après scan) est la suite naturelle et n'impose pas de refaire le travail.

**La queue longue des dimensions.** Au-delà de 200 locations, 50 companies et 20 power users
par repo, rien n'est stocké. Ce sont les bornes déjà appliquées par la route aujourd'hui
(`route.ts:163`, `173`, `181`), donc aucune régression, mais elles deviennent figées dans la
vue : les élargir imposera une reconstruction complète.

**La cohérence instantanée entre `totalStars` et le reste.** `totalStars` viendra de
`repo_stats_mv`, pas de `badge_cache`, pour que `mappingRate` reste cohérent avec `mappedCount`.
Ces deux compteurs divergent déjà aujourd'hui (60 418 `star_event` contre 71 568 stars annoncées
par GitHub sur `rtk-ai/rtk`), le précalcul ne crée pas ce décalage, il le fige entre deux
refresh.

**Environ 306 secondes de compute Neon par cycle**, soit un peu plus de dix minutes par jour
sur deux cycles. À mettre en regard des requêtes live supprimées : sur la fenêtre de deux
heures analysée, 42 requêtes ont brûlé 10 secondes chacune pour ne rien produire.

---

## 7. Vérification en production

Après activation, quatre contrôles.

`kamranahmedse/developer-roadmap` doit répondre avec `topCountries` non vide et
`isPartial` absent. C'est le cas test le plus dur, celui qu'aucun plan live ne peut satisfaire.

Les logs Vercel ne doivent plus contenir `[stats/totals timeout]` ni `[stats/power-users timeout]`,
hors repos fraîchement indexés. À vérifier avec `vercel-logs.sh --since 3h`, le même outil que
celui du diagnostic amont. Note connexe : `logError("stats/totals timeout", { owner, repo })`
produit `[object Object]` parce que `api-helpers.ts:101` attend une `Error`. Ce défaut
d'observabilité relève d'un autre lot mais conditionne la lecture de ce contrôle.

Le JSON de `/api/admin/refresh-repo-stats` remonte `durationMs` par vue. Les valeurs attendues
sont proches de 60 000, 40 000, 145 000 et 62 000 ms à froid, moins ensuite. Une dérive
au-dessus de 280 000 ms sur une seule vue est le signal d'alerte.

Enfin, un contrôle de justesse mensuel : comparer `repo_stats_mv.total` au `COUNT(*)` live sur
cinq repos tirés au hasard. Un écart au-delà de la fraîcheur attendue signalerait un refresh
silencieusement en échec.
