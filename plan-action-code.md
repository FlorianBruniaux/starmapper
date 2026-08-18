# Plan d'action code : correctifs coût Vercel

**Date** : 2026-08-16
**Périmètre** : items 9 à 16 de la section 7.2 de `research-vercel-cost-audit.md`, plus trois postes que l'audit n'a pas couverts.
**Méthode** : lecture du code applicatif et de `node_modules/next@16.2.11`, mesures locales de sérialisation et de compression, exécution de la suite de tests. Aucun fichier du repo modifié. Les mesures HTTP en production restent inaccessibles depuis mon sandbox, donc tout ce qui en dépend est marqué comme non vérifié.

**Baseline de tests mesurée** : `npx vitest run` passe en 8.06 s, 109 fichiers, **1222 tests**. Le chiffre de 872 qui circule dans `.claude/rules/tdd-mandatory.md` est périmé.

---

## 0. Cinq corrections à l'audit, mesurées

Avant de planifier, cinq points du rapport ne tiennent pas à la vérification. Deux d'entre eux changent une priorité.

### 0.1 L'item 9 ne peut rien rapporter sur Vercel

L'audit chiffre $2.20/mois sur la suppression de `compress: false` (`next.config.ts:9`). J'ai cherché tous les consommateurs de cette option dans le runtime Next 16.2.11 :

```
node_modules/next/dist/server/lib/router-server.js:29
    const _compression = require("next/dist/compiled/compression");
node_modules/next/dist/server/lib/router-server.js:114-116
    let compress;
    if ((config?.compress) !== false) { compress = compression(); }
node_modules/next/dist/server/lib/router-server.js:223-226
    if (compress) { compress(req, res, () => {}); }   // req/res Node bruts
node_modules/next/dist/server/config-shared.js:352
    compress: config.compress,     // simple recopie dans la config sérialisée
```

Un seul `require` du middleware de compression dans tout `next/dist/server/`, et il est dans `router-server.js`, le serveur HTTP de `next start`. Le middleware s'applique ligne 225 sur des `req`/`res` Node bruts, donc il exige un vrai socket HTTP. `config-shared.js:352` ne fait que recopier la valeur dans l'objet de configuration sérialisé, sans jamais l'appliquer.

Contre-vérification : la classe que le lanceur serverless de Vercel instancie est `NextServer` (`node_modules/next/dist/server/next-server.js`), et ce fichier contient **zéro** occurrence de la chaîne `compression`.

```bash
$ grep -c "compression" node_modules/next/dist/server/next-server.js
0
```

**Preuve décisive, apportée par l'agent infra et revérifiée ici.** Les traces de fichiers que Next.js émet au build (`.next/*.nft.json`) listent exactement ce qui part dans chaque bundle serveur. Le module de compression n'y figure pas :

```
$ node -e '...' sur .next/next-minimal-server.js.nft.json et .next/next-server.js.nft.json
next-minimal-server  | fichiers:   85 | refs compression: 0
                     | router-server refs: []
next-server          | fichiers:  698 | refs compression: 0
                     | router-server refs: ["…/dist/server/lib/router-utils/router-server-context.js"]
```

L'unique occurrence de `router-server` dans la seconde trace est `router-server-context.js`, un module de contexte sans rapport avec le serveur HTTP.

Ça ferme la question plus proprement que mon grep initial : **la question de savoir si `router-server.js` est instancié ou non ne se pose même pas.** `next/dist/compiled/compression` n'est référencé par aucun des deux bundles serveur, donc passer `compress` à `true` ne peut activer aucun code, puisque le code n'est pas expédié.

Détail cohérent : `.next/required-server-files.json` porte `config.compress: false`, c'est bien la configuration figée au build que le lanceur relit, et elle ne contredit rien.

**Conséquence** : retirer `compress: false` ne changera rien au compteur Fast Origin Transfer. Le gain à inscrire est **$0.00**, pas $2.20. Le changement reste bon à faire (une seconde, aucun risque, restaure la valeur par défaut pour un éventuel `next start`), mais il ne doit pas figurer dans la trajectoire d'économies.

**Limite de la vérification, et le test qui donnerait tort.** Les `.nft.json` décrivent ce que **Next.js déclare** nécessaire au bundle serveur, pas ce que le lanceur `@vercel/next` instancie réellement, et ce lanceur n'est pas dans `node_modules` (il vit côté build Vercel). L'incertitude résiduelle est donc mince mais réelle : elle porte sur ce que Vercel ajoute par-dessus la trace, pas sur ce que Next.js expédie. L'hypothèse d'un boot par `router-server.js` en `minimalMode` (le paramètre existe lignes 122, 189, 551) ne survit pas aux traces, puisque ce fichier n'est dans aucune des deux.

Ce qui la trancherait : le compteur **Fast Origin Transfer**, relevé à heure fixe 24 h avant et 24 h après le déploiement du lot 8, référence actuelle 1.47 GB/jour (91 GB sur 62 jours). Une chute nette sous 0.5 GB/jour me donne tort et confirme les $2.20/mois de l'audit. Une ligne plate me donne raison.

**Pourquoi le `curl` de la section 3.1 de l'audit ne peut pas trancher, dans un sens ni dans l'autre.** Point soulevé par l'agent infra, et il est juste. Le `content-encoding` que voit un client est posé par le CDN en sortie vers le client, alors que `compress` agirait sur le segment fonction vers edge, en amont. L'edge recompresse en sortie quel que soit l'état du segment amont. Un `content-encoding: br` sur un MISS est donc le comportement attendu dans les deux cas de figure et n'infirme rien. Son absence signalerait un problème différent et plus grave. J'avais annoncé ces deux commandes comme la mesure décisive, c'était faux : le seul instrument qui voit ce segment est le compteur de facturation.

**Conséquence de second ordre, plus importante** : si le levier global est inopérant, la compression explicite dans les handlers devient le seul moyen d'agir sur les 91 GB. Ça fait remonter l'item 16 (réécrit, voir §7) de « à faire seulement si le 9 ne suffit pas » à « seul levier disponible ». Cette conséquence tient même si l'hypothèse résiduelle ci-dessus se vérifie : dans ce cas les deux leviers s'additionnent au lieu de se substituer.

Note de coût sur le risque inverse, apportée par l'agent infra et que je reprends : si le levier s'avérait actif, le CPU gzip supplémentaire en fonction se facture sur Fluid Active CPU à $0.145/h. Compresser 54 GB coûte quelques minutes de CPU par mois, négligeable devant le transfert évité. Le changement n'a donc pas de risque de coût, seulement une espérance de gain incertaine.

### 0.2 Le profil `cacheLife("seconds")` n'a pas `stale: 0`

L'audit écrit `{ stale: 0, revalidate: 1, expire: 60 }`. La valeur réelle, lue dans `node_modules/next/dist/server/config-shared.js:142-146`, est `{ stale: 30, revalidate: 1, expire: 60 }`.

Table complète des profils intégrés en 16.2.11 (`config-shared.js:136-170`) :

| Profil | `stale` | `revalidate` | `expire` |
|---|---|---|---|
| `default` | `undefined` | 900 | infini |
| `seconds` | 30 | **1** | 60 |
| `minutes` | 300 | **60** | 3 600 |
| `hours` | 300 | 3 600 | 86 400 |
| `days` | 300 | 86 400 | 604 800 |
| `weeks` | 300 | 604 800 | 2 592 000 |
| `max` | 300 | 2 592 000 | 31 536 000 |

Le pire cas de l'item 11 tient malgré la correction : `revalidate: 1` est bien la borne des écritures serveur, `stale` ne gouverne que le cache routeur côté client.

### 0.3 La sémantique du double `cacheLife` est un minimum par champ, et elle couple les items 10 et 11

`node_modules/next/dist/server/use-cache/cache-life.js:143-160` :

```js
if (profile.revalidate !== undefined) {
  if (workUnitStore.explicitRevalidate === undefined ||
      workUnitStore.explicitRevalidate > profile.revalidate) {
    workUnitStore.explicitRevalidate = profile.revalidate;
  }
}
// idem pour expire et stale, indépendamment
```

Le commentaire de `page.tsx:48-53` dit vrai : le second appel ne peut que raccourcir. Mais ça produit une contrainte d'ordre que l'audit ne mentionne pas.

**Si l'item 11 est appliqué seul**, avec la base restée sur `cacheLife("minutes")` (revalidate 60), remplacer `cacheLife("seconds")` par `cacheLife({ revalidate: 60, ... })` donne `min(60, 60) = 60`. La branche `isPartial` devient strictement identique à la branche normale : la protection disparaît, le gain est nul et le comportement dégradé décrit dans le commentaire revient. **L'item 11 n'a de sens qu'après l'item 10.** Les deux partent dans le même commit.

### 0.4 Le taux de compression réel des props `/repos` est 6.2×, pas 12×

Mesuré localement sur 5 000 `RepoItem` aux valeurs variées (owners, repos, langages, tiers et dates aléatoires, ce qui évite le biais d'un tableau d'items identiques) :

| Payload | Brut | Gzip | Ratio | Brotli | Ratio |
|---|---|---|---|---|---|
| 500 `RepoItem` | 134 KB | 22 KB | 6.0× | 17 KB | 8.0× |
| 5 000 `RepoItem` | 1 344 KB | 218 KB | **6.2×** | 160 KB | 8.4× |

Un `RepoItem` sérialisé pèse 269 octets (l'audit dit 266, écart négligeable). Les 5 000 items passés deux fois font donc **2.62 MB** de props par rendu, pas 2.54 MB.

Le ratio de 12× annoncé était optimiste d'un facteur 2. L'audit ayant appliqué un abattement sur son chiffrage final, ses $/mois restent dans la bonne fourchette.

### 0.5 Item 12 : 13 sites facturés, pas 14

`src/components/map/followers-panel.tsx:226` figure dans la liste de la section 4.1 de l'audit. Ce n'est pas un `next/image`, c'est une balise `<img>` brute avec un `eslint-disable-next-line @next/next/no-img-element` juste au-dessus. Zéro transformation facturée sur ce site.

Décompte réel : 17 `<Image>` ou `<NextImage>` dans `src/`, dont 4 portent déjà `unoptimized` (`feeds/page.client.tsx:96`, `feed/[login]/page.tsx:110` et `:158`, `followers-user-switcher.tsx:200`). **13 sites facturés**, listés en §3.

---

## 1. Item 14 : borner la cardinalité du cache de `/api/repos`

Le plus petit diff du lot, à faire en premier parce qu'il ferme un vecteur de pollution sans rien casser.

### Le problème exact

`src/app/api/repos/route.ts:21` accepte n'importe quel entier jusqu'à 10 000. Cette valeur devient un argument de `fetchReposData(limit, diverse)` (`src/lib/repos-query.ts:39`), qui porte `"use cache"` avec `cacheTag("repos")`. La clé de cache inclut les arguments, donc `?limit=1`, `?limit=2`, `?limit=3` créent trois entrées distinctes de plusieurs centaines de kilo-octets chacune. Dix mille requêtes triviales suffisent à écrire dix mille entrées.

### La contrainte que l'audit a ratée

Une allowlist stricte casserait le MCP. `mcp/src/tools/list_repos.ts:6` fait `Math.min(args.limit ?? 50, 200)` et passe l'entier tel quel à `/api/repos?limit=N` (`mcp/src/client.ts:151`). Un LLM peut donc demander 10, 37 ou 173. Rejeter ces valeurs casse l'outil ; renvoyer 50 repos quand on en demande 10 casse l'affichage, `list_repos.ts:13-19` imprime tout ce qu'il reçoit.

### La solution : quantifier la clé de cache, trancher le résultat

On arrondit vers le haut sur une échelle courte pour la clé de cache, puis on tranche à la valeur exacte demandée en dehors de la fonction cachée. Cinq entrées de cache au maximum, sémantique inchangée pour tous les appelants.

L'équivalence est exacte, y compris sur le chemin `diverse`. La requête SQL est `ORDER BY bc."updatedAt" DESC LIMIT ${pool}` (`repos-query.ts:62-63`), et le filtre de diversité (`repos-query.ts:76-87`) parcourt ce tableau dans l'ordre en s'arrêtant à `limit`. Un pool plus grand est un sur-ensemble ordonné du plus petit, donc les N premiers éléments retenus sont identiques. Trancher les 50 premiers à 6 donne exactement ce que `limit=6` aurait produit.

### Diff

**Avant** (`src/app/api/repos/route.ts:17-28`) :

```ts
export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 10000) : 500;
    const diverse = url.searchParams.get("diverse") === "true";

    const { repos, total } = await fetchReposData(limit, diverse);

    return NextResponse.json({ repos, total } satisfies ReposResponse, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
```

**Après** :

```ts
// Cache-key quantisation. fetchReposData() carries "use cache", so its arguments are
// part of the cache key: an unbounded `limit` mints one multi-hundred-KB entry per
// distinct integer (?limit=1, ?limit=2, ...). Snapping up to a five-rung ladder caps
// the entry count at five, and slicing afterwards keeps the response byte-identical
// to what an exact limit would have returned.
//
// Equivalence holds on the diverse path too: repos-query.ts:62 orders by updatedAt DESC
// and repos-query.ts:85 stops at `limit`, so a larger pool is an ordered superset and
// the first N retained rows are the same.
//
// Rejecting off-ladder values is not an option: mcp/src/tools/list_repos.ts:6 forwards
// any integer up to 200, and its output prints every row it receives.
const LIMIT_LADDER = [12, 50, 200, 500, 5000] as const;
const MAX_LIMIT = LIMIT_LADDER[LIMIT_LADDER.length - 1];

const quantiseLimit = (limit: number): number =>
  LIMIT_LADDER.find((rung) => rung >= limit) ?? MAX_LIMIT;

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : 500;
    const diverse = url.searchParams.get("diverse") === "true";

    const { repos, total } = await fetchReposData(quantiseLimit(limit), diverse);

    return NextResponse.json({ repos: repos.slice(0, limit), total } satisfies ReposResponse, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
```

Note sur `parseInt` : le code actuel ne garde pas contre `NaN`. `?limit=abc` donne `Math.min(NaN, 10000) = NaN`, qui part dans le `LIMIT ${pool}` de la requête raw. Le garde `Number.isFinite` ci-dessus ferme ce trou au passage, il n'est pas décoratif.

### Tests

`src/app/api/repos/__tests__/route.test.ts` ne passe jamais de `limit` (le helper `makeReq` accepte des params mais aucun test n'en fournit). **Zéro test cassé.**

Cinq tests neufs à ajouter dans un bloc `describe("limit handling")` :

```ts
it("quantises limit=1 to the first ladder rung but returns exactly 1 row", ...)
// mock 12 rows → attendre json.repos.length === 1

it("caps limit above the ladder max at 5000", ...)
// ?limit=99999 → fetchReposData appelé avec 5000

it("falls back to 500 on a non-numeric limit", ...)
// ?limit=abc → pas de NaN dans l'argument

it("passes the exact ladder value through when limit matches a rung", ...)
// ?limit=50 → fetchReposData(50, false)

it("preserves total independently of the slice", ...)
// total reste celui du COUNT(*), pas repos.length
```

Pour observer l'argument passé à `fetchReposData`, il faut le mocker : le test actuel mocke `@/lib/db` et laisse `repos-query.ts` s'exécuter. Deux options, la seconde est plus propre. Soit ajouter `vi.mock("@/lib/repos-query")` dans un fichier de test séparé, soit compter les lignes du résultat en pilotant `mockQueryRaw`, ce qui teste l'observable plutôt que l'implémentation. Je recommande la seconde pour quatre des cinq tests, et un `vi.mock` isolé pour le seul test qui doit voir l'argument brut.

---

## 2. Items 10 et 11 : fenêtres `cacheLife` et invalidation par tag

C'est le lot qui rapporte le plus. Il part en un seul commit parce que l'item 11 est inopérant sans l'item 10 (§0.3).

### 2.1 Ce que l'audit n'a pas vu : un tag mort

`src/app/[owner]/[repo]/page.tsx:40` pose `cacheTag(\`repo-stats-${owner}-${repo}\`)`. J'ai cherché ce tag dans tout le repo :

```
$ grep -rn "revalidateTag" --include="*.ts" --include="*.tsx" src/
badge-update/route.ts:107   revalidateTag(`badge-${owner}-${repo}`, "hours")
badge-update/route.ts:108   revalidateTag(`repo-info-${owner}-${repo}`, { expire: 300 })
badge-update/route.ts:109   revalidateTag("repos", { expire: 300 })
contributors-badge-update/route.ts:43  revalidateTag("repos", { expire: 300 })
refresh-grid-mv/route.ts:95-96         revalidateTag("trending"), revalidateTag("explore-mvs")
refresh-trending/route.ts:103          revalidateTag("trending", "hours")
news/route.ts:75                       revalidateTag(`feed-${authorLogin}`, "hours")
```

`repo-stats-*` n'apparaît nulle part en écriture. **Le tag est posé et jamais invalidé.** Aujourd'hui ça ne se voit pas, `revalidate: 60` masque le problème. Dès qu'on passe à 600 s, la fraîcheur des stats après un scan repose uniquement sur l'horloge.

Même défaut sur `profile-${login}` (`src/app/profile/[login]/page.tsx:13`), jamais invalidé, y compris par `/api/profile/[login]/refresh` qui existe pourtant pour ça. Et sur `roadmap-vote-tallies` (`roadmap/page.tsx:42`).

La conséquence pratique : allonger `revalidate` sans poser l'invalidation par tag, c'est acheter des écritures ISR en moins contre de la fraîcheur en moins. Poser le tag en même temps, c'est acheter les écritures en moins gratuitement. C'est un point où l'audit sous-spécifie le correctif, et c'est un ajout de trois lignes.

### 2.2 Argumentaire des valeurs, poste par poste

`fetchRepoInfo` (`page.tsx:23-36`) sert le nom, la description, le nombre d'étoiles, le langage, l'avatar, les forks, les watchers et le nombre de contributeurs. Deux sources de changement, et une seule est instantanée.

La donnée sous-jacente vient de `/api/repo-info`, qui pose déjà `next: { revalidate: 300, tags: [...] }` sur son propre `fetch()` vers `api.github.com` (`repo-info/route.ts:24`) plus un `Cache-Control: s-maxage=300` (ligne 50). Autrement dit **la donnée GitHub est déjà figée 5 minutes en amont** : descendre en dessous de 300 s côté `cacheLife` ne rafraîchit rien, ça réécrit la même valeur. Le `revalidate: 60` actuel fait donc 4 écritures inutiles sur 5.

Le seul événement qui doit produire un rafraîchissement immédiat est la fin d'un scan, et il est déjà couvert par `revalidateTag(\`repo-info-${owner}-${repo}\`, { expire: 300 })` à `badge-update/route.ts:108`.

Verdict : l'invalidation par tag couvre le besoin de fraîcheur métier. Le `revalidate` temporel peut monter au maximum raisonnable. **`{ stale: 300, revalidate: 900, expire: 86400 }`**. Le `expire: 86400` compte autant que le `revalidate` : avec `minutes` l'entrée meurt au bout d'une heure, donc un repo visité deux fois dans la journée paie deux écritures complètes. Sur la longue traîne des repos peu consultés, c'est `expire` qui commande, pas `revalidate`.

`fetchStats` (`page.tsx:38-59`) sert les agrégats. Trois sources de changement.

Un scan qui se termine écrit `star_event` et `github_user` puis `badge_cache` via `/api/badge-update`. Le cron `refresh-repo-stats` reconstruit `repo_stats_mv` et ses trois vues de dimension à 02:00 et 14:00 UTC (`vercel.json:19-26`), soit deux fois par jour. Et sur le chemin `live`, la valeur bouge à chaque nouvel événement d'étoile indexé.

En dehors de ces trois moments, rien ne change. Une fenêtre de 60 s n'a aucune justification métier : sur un scan de stargazers, l'utilisateur voit de toute façon les stats fraîches, parce que `useScanController.ts:244` et `:367` refont un `fetch("/api/stats/…")` direct depuis le navigateur à la fin du scan, sans passer par le cache SSR. Le cache `"use cache"` ne sert que le premier rendu des visiteurs suivants.

Verdict : **`{ stale: 300, revalidate: 600, expire: 86400 }`**, plus l'ajout du `revalidateTag` manquant pour que la fin de scan reste instantanée pour les autres visiteurs.

Branche `isPartial`. Le raisonnement du commentaire `page.tsx:48-53` est juste et doit être préservé : un panneau vide ne doit pas rester figé. Mais `revalidate: 1` est un plancher non borné, 86 400 écritures par jour et par repo sous trafic continu. La route elle-même se cale sur 30 s dans ce cas (`stats/route.ts:408`), et c'est la bonne référence : aligner le SSR sur le CDN plutôt que d'inventer une troisième valeur.

Verdict : **`{ stale: 60, revalidate: 60, expire: 300 }`**. Soixante fois moins d'écritures dans le pire cas, une fenêtre d'affichage dégradé qui reste sous la minute, et un `expire: 300` qui garantit qu'une entrée partielle ne survit jamais plus de 5 minutes. Contrainte de validité : `revalidate <= expire`, sinon `validateCacheLife` lève `E656` (`cache-life.js:60-68`). 60 <= 300, c'est bon.

Les deux autres `cacheLife("minutes")` du repo, que le lead demandait de vérifier.

`src/app/profile/[login]/page.tsx:14`. Les données de profil (followers, company, location, langages) bougent quand `/api/profile/[login]/refresh` tourne, et cette route porte déjà un cooldown interne d'une heure plus un rate limit `rl:profile-refresh` de 10 par heure (`proxy.ts:78`). Rafraîchir le cache SSR toutes les 60 s pour une donnée qui ne peut pas changer plus d'une fois par heure, c'est 59 écritures perdues sur 60. **`{ stale: 300, revalidate: 1800, expire: 86400 }`**, plus le `revalidateTag(\`profile-${login}\`)` manquant dans la route de refresh.

`src/app/roadmap/page.tsx:43`. Ce sont des tallies de vote. Un votant qui vote reçoit les tallies à jour dans la réponse du POST (`roadmap-vote/route.ts:65`), donc il ne dépend pas du cache SSR. La route GET se cale déjà sur `s-maxage=30` (ligne 77). Le seul enjeu est qu'un visiteur qui arrive voie un compteur pas trop vieux. **`{ stale: 300, revalidate: 900, expire: 3600 }`**. Un compteur de sondage vieux de 15 minutes ne pose aucun problème, et cette page est dans le sitemap donc elle est crawlée.

### 2.3 Diffs

**`src/app/[owner]/[repo]/page.tsx:23-26`**

Avant :

```ts
const fetchRepoInfo = async (owner: string, repo: string): Promise<RepoInfo | null> => {
  "use cache";
  cacheTag(`repo-info-${owner}-${repo}`);
  cacheLife("minutes");
```

Après :

```ts
const fetchRepoInfo = async (owner: string, repo: string): Promise<RepoInfo | null> => {
  "use cache";
  cacheTag(`repo-info-${owner}-${repo}`);
  // Freshness is driven by the tag, not the clock: badge-update/route.ts:108 busts this
  // entry the moment a scan completes. The underlying GitHub data is already frozen for
  // 300s upstream (repo-info/route.ts:24 sets next.revalidate = 300), so anything below
  // that only rewrites an identical value. expire matters as much as revalidate here:
  // the "minutes" profile drops the entry after 3600s, so a repo visited twice in a day
  // paid two full writes for data that had not changed.
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 });
```

**`src/app/[owner]/[repo]/page.tsx:38-55`**

Avant :

```ts
const fetchStats = async (owner: string, repo: string): Promise<RepoStats | null> => {
  "use cache";
  cacheTag(`repo-stats-${owner}-${repo}`);
  cacheLife("minutes");
  try {
    const res = await fetch(
      `${APP_URL}/api/stats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    if (!res.ok) return null;
    const stats = (await res.json()) as RepoStats;
    // The route already shortens its own Cache-Control to 30s when the Neon
    // aggregation timed out, but that header only governs the CDN. This SSR
    // path is governed by cacheLife alone, and "minutes" would hold a stats
    // panel with empty countries/cities/companies for revalidate=60s with a
    // 300s stale window. cacheLife keeps the minimum across calls, so this
    // second call can only shorten the entry, never extend it.
    if (stats.isPartial) cacheLife("seconds");
```

Après :

```ts
const fetchStats = async (owner: string, repo: string): Promise<RepoStats | null> => {
  "use cache";
  cacheTag(`repo-stats-${owner}-${repo}`);
  // The aggregates move on exactly three events: a scan finishing (badge-update now busts
  // this tag), the refresh-repo-stats cron at 02:00 and 14:00 UTC (vercel.json:19-26), and
  // new star_event rows on the live path. None of them justifies a 60s clock: the scanning
  // client refetches /api/stats directly anyway (useScanController.ts:244 and :367), so this
  // entry only ever serves the first render of later visitors.
  cacheLife({ stale: 300, revalidate: 600, expire: 86400 });
  try {
    const res = await fetch(
      `${APP_URL}/api/stats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    if (!res.ok) return null;
    const stats = (await res.json()) as RepoStats;
    // The route already shortens its own Cache-Control to 30s when the Neon
    // aggregation timed out, but that header only governs the CDN. This SSR
    // path is governed by cacheLife alone, and the window above would hold a
    // stats panel with empty countries/cities/companies for 600s.
    // cacheLife keeps the minimum per field across calls (cache-life.js:143-160),
    // so this second call can only shorten the entry, never extend it.
    //
    // Not cacheLife("seconds"): its revalidate of 1 is an unbounded floor, 86 400 ISR
    // writes per day per repo under continuous traffic. 60s mirrors the s-maxage=30 the
    // route sets on the same condition (stats/route.ts:408) instead of inventing a third
    // number, and expire=300 caps how long a degraded entry can survive.
    if (stats.isPartial) cacheLife({ stale: 60, revalidate: 60, expire: 300 });
```

**`src/app/api/badge-update/route.ts:106-109`**

Avant :

```ts
    // Invalidate cached data for this repo immediately after scan completion
    revalidateTag(`badge-${key.owner}-${key.repo}`, "hours");
    revalidateTag(`repo-info-${key.owner}-${key.repo}`, { expire: 300 });
    revalidateTag("repos", { expire: 300 }); // landing page + /repos list
```

Après :

```ts
    // Invalidate cached data for this repo immediately after scan completion
    revalidateTag(`badge-${key.owner}-${key.repo}`, "hours");
    revalidateTag(`repo-info-${key.owner}-${key.repo}`, { expire: 300 });
    // page.tsx:40 has always tagged its stats entry, but nothing ever busted it: the tag
    // was dead and freshness rode entirely on the 60s clock. That clock is now 600s, so
    // the tag has to do the work it was written for.
    revalidateTag(`repo-stats-${key.owner}-${key.repo}`, { expire: 300 });
    revalidateTag("repos", { expire: 300 }); // landing page + /repos list
```

**`src/app/profile/[login]/page.tsx:12-14`**

Avant :

```ts
  "use cache";
  cacheTag(`profile-${login}`);
  cacheLife("minutes");
```

Après :

```ts
  "use cache";
  cacheTag(`profile-${login}`);
  // POST /api/profile/[login]/refresh carries a 1h internal cooldown and a 10/hour rate
  // limit (proxy.ts:78), so the underlying row cannot change more than once an hour. A 60s
  // clock threw away 59 writes out of 60. The refresh route now busts this tag.
  cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
```

Plus, dans `src/app/api/profile/[login]/refresh/route.ts`, ajouter l'import `revalidateTag` depuis `next/cache` et l'appel `revalidateTag(\`profile-${login}\`, { expire: 300 })` juste après l'écriture réussie. Le fichier ne contient aujourd'hui aucun `revalidateTag` (vérifié par grep), il faut donc ajouter l'import.

**`src/app/roadmap/page.tsx:41-43`**

Avant :

```ts
  "use cache";
  cacheTag("roadmap-vote-tallies");
  cacheLife("minutes");
```

Après :

```ts
  "use cache";
  cacheTag("roadmap-vote-tallies");
  // A voter gets fresh tallies straight back from the POST (roadmap-vote/route.ts:65), so
  // this entry only serves arriving visitors. The GET itself sits behind s-maxage=30 at the
  // CDN. A poll counter 15 minutes old is not a defect, and /roadmap is in the sitemap so
  // it takes crawler traffic.
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
```

### 2.4 Chiffrage, avec la méthode

Modèle : pour une frontière `"use cache"` et un couple `(owner, repo)` recevant du trafic continu, le nombre d'écritures par jour est `min(requêtes/jour, 86400 / revalidate)`. Sous crawl continu la borne du haut est atteinte.

| Frontière | `revalidate` avant | Écritures/j/repo avant | `revalidate` après | Après | Facteur |
|---|---|---|---|---|---|
| `fetchRepoInfo` | 60 | 1 440 | 900 | 96 | 15× |
| `fetchStats` | 60 | 1 440 | 600 | 144 | 10× |
| **Total par repo** | | **2 880** | | **240** | **12×** |

L'audit attribue environ 45 000 écritures/jour à ces deux frontières, soit 58 % du total et $5.50/mois. Une réduction d'un facteur 12 laisse 3 750 écritures/jour, soit **41 250 de moins**, soit $5.04/mois.

Deux façons de présenter ce chiffre, il faut choisir selon l'ordre de déploiement.

**Si les items code partent avant les règles WAF** : $5.04/mois.
**Si le WAF part d'abord et retire 65 % du trafic** : $5.04 × 0.35 = **$1.76/mois**. C'est le chiffre à retenir dans la trajectoire, l'audit annonce $2.40 par le même raisonnement.

L'item 11 n'entre pas dans ce calcul : son gain est de $0 si aucun repo n'est en `isPartial` sous trafic, et jusqu'à $9/mois sinon. Voir §2.5.

Sur les profils et le roadmap, gain non chiffré séparément : ils tombent dans la ligne « Reste » de l'audit, ~8 000 écritures/jour et $0.95/mois. Le facteur y est du même ordre, disons $0.40 à $0.60/mois.

### 2.5 Item 11 : la mesure d'abord, et elle ne demande aucun déploiement

Le lead demande l'instrumentation la moins invasive. La bonne réponse est qu'il n'y a rien à instrumenter : le signal existe déjà, à deux endroits, et un troisième se lit en SQL.

`isPartial` est levé par `partial = joinTimedOut || mvIncomplete` (`stats/route.ts:371`). Les deux branches se mesurent séparément.

**Branche `joinTimedOut`, déjà journalisée.** `stats/route.ts:186` écrit `logError(\`stats/totals timeout [${owner}/${repo}]\`, err)`, ce qui produit dans les logs Vercel une ligne préfixée `[stats/totals timeout [owner/repo]]`. Une recherche plein texte sur `stats/totals timeout` dans Vercel Observability sur 24 h donne directement le compte et la liste des repos concernés. Aucune ligne de code, aucun déploiement. Les trois autres timeouts (`stats/location`, `stats/company`, `stats/power-users`, via `queryOrEmpty` ligne 210) se lisent de la même façon et permettent de distinguer un timeout global d'un timeout de dimension.

**Branche `mvIncomplete`, mesurable en SQL sans toucher à la prod.** Elle vaut `mvRow !== null && (mvDegraded || (total > 0 && locationRows.length === 0))` (`stats/route.ts:369-370`). Le second terme est une requête sur les vues :

```sql
-- Nombre de repos qui serviraient isPartial=true par mvIncomplete.
SET statement_timeout = 0;
SELECT count(*) AS incomplete
FROM repo_stats_mv r
LEFT JOIN (SELECT DISTINCT owner, repo FROM repo_location_stats_mv) l
  ON l.owner = r.owner AND l.repo = r.repo
WHERE r.total > 0 AND l.owner IS NULL;
```

Une seule lecture, zéro écriture. Le premier terme, `mvDegraded`, est journalisé par `mvQueryOrEmpty` (`stats/route.ts:233`) sous les tags `stats/location-mv`, `stats/company-mv`, `stats/power-users-mv`.

**Le préalable qui commande tout** : vérifier la valeur de `REPO_STATS_MV_ENABLED` en production (`vercel env ls`). Le flag est lu à chaque requête et non figé au cold start, c'est explicité en commentaire à `stats/route.ts:112-115`.

Si le flag est **à `true` et que `repo_stats_mv` est peuplée**, le chemin live n'est pas emprunté, donc `joinTimedOut` est structurellement impossible et seul `mvIncomplete` peut lever `isPartial`. La requête SQL ci-dessus suffit alors à trancher entièrement l'item 11.

Si le flag est **absent ou à `false`**, tout passe par la jointure live et c'est la recherche de logs qui compte.

**Le seul angle mort**, et c'est le seul endroit où une ligne de code se justifie : la branche `total > 0 && locationRows.length === 0` ne journalise rien. Si la mesure SQL est jugée insuffisante, ajouter une ligne dans `stats/route.ts` juste après le calcul de `mvIncomplete` :

```ts
if (mvIncomplete) logError(`stats/mv-incomplete [${key.owner}/${key.repo}]`, new Error("dimension views empty"));
```

Utiliser `logError` et non `console.warn` pour rester sur le même canal que le reste de la route et bénéficier de `sanitizeError`. À retirer une fois la mesure faite, ou à garder, elle ne coûte qu'un événement Observability sur un cas déjà anormal.

**Décision conditionnée au résultat**, à écrire noir sur blanc avant de mesurer pour éviter de rationaliser après coup :

| Résultat de la mesure sur 24 h | Décision |
|---|---|
| 0 occurrence | Appliquer quand même le diff §2.3 (borne un risque de queue à coût nul), inscrire **$0** de gain |
| 1 à 20 repos, trafic faible | Appliquer, inscrire $0 à $0.50 |
| Un repo populaire en `isPartial` permanent | Appliquer, inscrire le gain réel, et **traiter la cause** : le repo en question a un problème de vue ou de timeout qui mérite son propre ticket |

Dans les trois cas le diff part. Ce qui change, c'est le chiffre inscrit dans la trajectoire et l'existence ou non d'un ticket de suivi.

### 2.6 Tests

Aucun test existant ne touche `page.tsx`, ni `roadmap/page.tsx`, ni `profile/[login]/page.tsx`. `.claude/rules/tdd-mandatory.md` classe explicitement `src/app/[owner]/[repo]/page.tsx` en « à sauter », serveur plus boucle client, territoire E2E. Rien ne casse.

`src/app/api/badge-update/__tests__/route.test.ts` existe. Il faut vérifier s'il mocke `next/cache`. S'il compte les appels à `revalidateTag`, l'ajout d'un quatrième appel cassera l'assertion. Vérification en une commande avant de coder :

```bash
grep -n "revalidateTag\|next/cache" src/app/api/badge-update/__tests__/route.test.ts
```

Test neuf à ajouter dans ce fichier :

```ts
it("busts the repo-stats tag so a finished scan is visible to later visitors", async () => {
  // ... POST valide ...
  expect(revalidateTagSpy).toHaveBeenCalledWith("repo-stats-octocat-hello", { expire: 300 });
});
```

Test neuf pour la route de refresh de profil, dans `src/app/api/profile/[login]/refresh/__tests__/` (le répertoire existe) :

```ts
it("busts the profile tag after a successful refresh", ...)
it("does not bust the tag when the cooldown blocks the refresh", ...)
```

Le second compte autant que le premier : invalider un tag sur un no-op provoque une réécriture gratuite au prochain read.

Les valeurs de `cacheLife` elles-mêmes ne sont pas testables en unitaire, `cacheLife()` lève `E887` hors `cacheComponents` et `E818` hors d'une fonction `"use cache"` (`cache-life.js:71-99`). Ne pas essayer. La vérification est un `pnpm build` propre, puis l'observation du compteur ISR Writes après déploiement.

---

## 3. Item 12 : les 13 avatars `next/image`

Le meilleur ratio du lot. Aucun risque, aucun test à écrire, effet immédiat sur deux lignes de facture.

### 3.1 Pourquoi `unoptimized` suffit, et pourquoi `?size=` est un bonus qui ne rapporte rien sur la facture

Deux options existent, et l'audit recommande la seconde. Je ne suis pas d'accord sur la hiérarchie, pour une raison de compteur.

`unoptimized` supprime la transformation Vercel. Ça touche **Image Optimization** ($1.45/mois) et **Image Optimization Cache Writes** ($0.11/mois). C'est la totalité des $1.56.

`?size=48` réduit les octets transférés du CDN GitHub vers le navigateur. Ce trajet ne passe **pas** par Vercel : c'est le navigateur qui va chercher `github.com/login.png` directement. Ça n'apparaît sur aucune ligne de la facture Vercel. Le bénéfice est réel mais il est pour l'utilisateur, pas pour le portefeuille.

De plus, `?size=` demande deux syntaxes selon l'origine : `github.com/{login}.png?size=48` d'un côté, `avatars.githubusercontent.com/u/123?v=4&s=48` de l'autre. Les composants reçoivent des `avatarUrl` des deux formes (`stats/route.ts:336` construit la première, `repo-info/route.ts:46` renvoie `data.owner.avatar_url` qui est la seconde). Traiter les deux demande un helper, donc un fichier neuf, donc de l'appareillage pour un gain hors facture.

**Recommandation : ajouter `unoptimized` sur les 13 sites, point.** Treize éditions d'un mot, aucun helper, aucun test. Si le poids client devient un sujet, le helper `?size=` fera l'objet d'un ticket séparé sous le scope `ui`, avec un vrai budget LCP à l'appui.

### 3.2 Les 13 diffs

Sept sites sont sur une seule ligne, l'édition est un ajout de `unoptimized ` avant le `/>`.

| # | Fichier:ligne | Édition |
|---|---|---|
| 1 | `src/components/map/all-stargazers-modal.tsx:426` | `... className="w-6 h-6 rounded-full flex-shrink-0" unoptimized />` |
| 2 | `src/components/map/stats-modal.tsx:187` | `... className="w-6 h-6 rounded-full ring-1 ring-border flex-shrink-0" unoptimized />` |
| 3 | `src/components/map/stats-modal.tsx:284` | `... className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border" unoptimized />` |
| 4 | `src/components/map/stats-modal.tsx:423` | `... className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border" unoptimized />` |
| 5 | `src/components/map/share-modal.tsx:179` | `... className="w-10 h-10 rounded-full border border-border flex-shrink-0" unoptimized />` |
| 6 | `src/components/map/top-panel.tsx:125` | `... className="size-5 rounded-full flex-shrink-0" unoptimized />` |
| 7 | `src/components/map/pre-scan-overlay.tsx:57` | `... className="w-10 h-10 rounded-full" unoptimized />` |
| 8 | `src/app/[owner]/page.client.tsx:290` | `... className="size-14 rounded-full border border-border" unoptimized />` |

Exemple complet pour le site 1, `src/components/map/all-stargazers-modal.tsx:426`.

Avant :

```tsx
                          ? <NextImage src={u.avatarUrl} alt="" width={24} height={24} sizes="24px" className="w-6 h-6 rounded-full flex-shrink-0" />
```

Après :

```tsx
                          ? <NextImage src={u.avatarUrl} alt="" width={24} height={24} sizes="24px" className="w-6 h-6 rounded-full flex-shrink-0" unoptimized />
```

Les cinq sites restants sont multilignes. Ajouter `unoptimized` sur sa propre ligne, en respectant l'indentation locale.

**9. `src/app/explore/page.client.tsx:985-992`**

Avant :

```tsx
                          <Image
                            src={u.avatarUrl}
                            alt={`Avatar of ${u.login}`}
                            width={32}
                            height={32}
                            loading="lazy"
                            className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border"
                          />
```

Après : identique, avec `                            unoptimized` inséré après la ligne `loading="lazy"`.

**10. `src/app/explore/page.client.tsx:1101-1108`** et **11. `src/app/explore/page.client.tsx:1321-1328`** : même bloc, mêmes props, indentations respectives de 32 et 34 espaces. Même insertion.

**12. `src/app/profile/[login]/page.client.tsx:582-589`**

Avant :

```tsx
            <Image
              src={`https://github.com/${profile.login}.png`}
              alt={`${profile.login} avatar`}
              className="size-20 rounded-full border border-border shrink-0"
              width={80}
              height={80}
              priority
            />
```

Après : ajouter `              unoptimized` après `priority`.

Attention sur celui-ci : `priority` et `unoptimized` cohabitent sans problème, `priority` ne fait que poser `fetchpriority="high"` et un preload. Le preload d'une URL non optimisée est correct.

**13. `src/app/profile/[login]/page.client.tsx:1186-1193`**

Avant :

```tsx
                            <Image
                              src={`https://github.com/${u.login}.png`}
                              alt=""
                              className="size-9 rounded-full border border-border"
                              width={36}
                              height={36}
                              loading="lazy"
                            />
```

Après : ajouter `                              unoptimized` après `loading="lazy"`.

### 3.3 Ce qu'il ne faut PAS toucher

`src/components/map/followers-panel.tsx:226` est un `<img>` brut avec son `eslint-disable`. Il ne coûte rien. Le laisser tel quel.

`next.config.ts:11-17` garde ses `remotePatterns`. `unoptimized` court-circuite le loader, mais les patterns restent nécessaires pour tout `<Image>` optimisé futur, et les retirer serait un changement non chirurgical.

### 3.4 Tests

`src/components/map/stats-modal.test.tsx` existe. Il faut vérifier qu'aucune assertion ne porte sur le `src` rendu : sans `unoptimized`, Next réécrit le `src` en `/_next/image?url=…&w=…&q=75` ; avec, le `src` reste l'URL d'origine. Une assertion de type `expect(img.getAttribute("src")).toContain("_next/image")` casserait.

```bash
grep -n "src=\|getAttribute\|toHaveAttribute" src/components/map/stats-modal.test.tsx
```

Vérification visuelle après application : ouvrir `/facebook/react`, ouvrir la modale de stats, confirmer dans l'onglet Réseau que les avatars partent vers `github.com` ou `avatars.githubusercontent.com` et non vers `/_next/image`.

Aucun test neuf n'est justifié. Tester la présence d'un attribut de configuration sur un composant tiers ne vérifie rien d'utile ; le compteur Image Optimization du dashboard est la seule preuve qui compte, et il se lit 24 h après le déploiement.

---

## 4. Item 13 : les 5 000 repos transportés deux fois sur `/repos`

L'audit propose un changement en deux volets. Je les sépare parce qu'ils n'ont ni le même risque ni le même ratio.

### 4.1 Volet A : supprimer la duplication. Une ligne, aucune perte

`src/app/repos/_components/repos-client.tsx:25` passe `initialRepos` à `CommandSearch`. Or `src/components/command-search.tsx:32-39` sait déjà se débrouiller seul :

```tsx
useEffect(() => {
  if (reposProp) return;
  fetch("/api/repos")
    .then((r) => r.ok ? r.json() : null)
    .then((d) => { if (d?.repos) setFetchedRepos(d.repos); })
    .catch(() => {});
}, [reposProp]);
```

C'est exactement ce qui se passe déjà sur `/`, sur `/[owner]` (`page.client.tsx:79`) et partout ailleurs. La page `/repos` est la seule à passer le prop, et elle le fait avec 5 000 items là où le self-fetch en ramènerait 500.

Retirer le prop divise par deux la charge RSC de la page : **2.62 MB → 1.31 MB**.

Diff, `src/app/repos/_components/repos-client.tsx:25` :

```diff
-      <CommandSearch repos={initialRepos} />
+      {/* No repos prop on purpose: CommandSearch self-fetches /api/repos (500 rows) when
+          the prop is absent, exactly as on / and /[owner]. Passing initialRepos here put
+          the same 5 000-row array on the RSC wire twice, 1.31 MB of pure duplication for
+          a search box that only ever renders 12 results (command-search.tsx:47-53). */}
+      <CommandSearch />
```

Effet secondaire à assumer : la recherche Cmd+K sur `/repos` couvre 500 repos au lieu de 5 000. C'est déjà le comportement de toutes les autres pages, donc ça uniformise plutôt que ça ne dégrade. Si ça gêne, la vraie réponse est une recherche serveur, pas un tableau de 5 000 dans le navigateur.

Chiffrage. L'audit estime environ 150 rendus origine par jour sur `/repos` (1.2k requêtes/24 h à 87.4 % de hit CDN). 150 × 1.31 MB = **196 MB/jour** économisés, soit 12.2 GB sur 62 jours, soit $0.83 sur la période à $0.068/GB, soit **$0.41/mois**. Pour une ligne.

### 4.2 Volet B : réduire le tableau de 5 000 à 500. À ne pas faire tel quel

L'audit propose `fetchReposData(5000)` → 500. Trois objections.

**Le gain marginal est faible une fois le volet A fait.** 1.31 MB → 134 KB sur les 150 rendus, soit 176 MB/jour de plus, $0.37/mois. Cumul volet A plus volet B : $0.78/mois.

**Ça supprime une fonctionnalité qui a l'air d'être le point de la page.** `src/components/repo-table.tsx` trie côté client sur six colonnes (`totalCount`, `mappedPercent`, `countryCount`, `updatedAt`, `organicScore`, `dependentsCount`, ligne 13) et pagine par 20. Trier par score organique sur 5 000 repos et trier sur 500 ne donnent pas le même podium. La page s'appelle « All mapped repos » et affiche « {total} repositories scanned by the community ». Passer à 500 sans changer ce texte, c'est mentir à l'utilisateur.

**On ne sait pas combien de repos il y a réellement.** Si `badge_cache` filtré sur l'existence d'une entrée `stargazer_cache` contient moins de 5 000 lignes, `fetchReposData(5000, false)` en retourne déjà moins et le problème est plus petit qu'annoncé. Requête à passer avant de décider, une lecture :

```sql
SELECT count(*) FROM badge_cache bc
WHERE EXISTS (SELECT 1 FROM stargazer_cache sc WHERE sc.owner = bc.owner AND sc.repo = bc.repo);
```

**Recommandation** : faire le volet A, encaisser $0.41/mois pour une ligne, et ouvrir un ticket séparé sous scope `ui` pour le volet B avec le tri et la pagination côté serveur. Un tri serveur sur 5 000 lignes indexées est trivial ; c'est le portage du tri client vers des query params qui coûte l'heure annoncée. Mélanger ça avec un lot de correctifs de coût brouille les deux.

### 4.3 Tests

`repos-client.tsx` et `command-search.tsx` n'ont pas de fichier de test. Rien ne casse.

Vérification manuelle après application : ouvrir `/repos`, presser Cmd+K, taper « react », confirmer que des résultats remontent. Dans l'onglet Réseau, confirmer un `GET /api/repos` déclenché au montage et une charge RSC divisée par deux (mesurable sur la taille du document `/repos` dans DevTools).

---

## 5. Item 15 : les cinq auto-appels HTTP

Le plus délicat, et celui où le classement gain sur risque compte le plus. Le pattern cible existe : `src/app/devs/atlas/page.tsx:5` importe `fetchAtlasData` depuis `@/lib/devs-query`, où la fonction porte elle-même `"use cache"` et attaque Prisma directement (`devs-query.ts:38-41`).

### 5.1 Le classement, du meilleur ratio au pire

| Ordre | Route | Effort | Risque | Volume | Verdict |
|---|---|---|---|---|---|
| 1 | `/api/roadmap-vote` GET | 10 min | quasi nul | faible | **Faire**, c'est déjà extrait |
| 2 | `/api/explore` GET | 30 min | faible | 2.1k req/24 h | **Faire** |
| 3 | `/api/profile/[login]` GET | 1 h | faible | moyen | **Faire** |
| 4 | `/api/stats/[owner]/[repo]` GET | 2 h | modéré | **le plus fort** | **Faire, en dernier** |
| 5 | `/api/repo-info` GET | 1 h | **modéré** | fort | **Ne pas faire**, voir §5.6 |

### 5.2 Ordre 1, roadmap-vote. Déjà fait à 90 %

`src/app/api/roadmap-vote/route.ts:72-83` ne fait qu'appeler `getTallies()` depuis `@/lib/roadmap-vote` et emballer le résultat. La logique est déjà dans `src/lib/`. Il n'y a rien à extraire, seulement à cesser de passer par HTTP.

Diff, `src/app/roadmap/page.tsx`. Avant, lignes 40-51 :

```ts
const fetchTallies = async (): Promise<RoadmapVoteResponse> => {
  "use cache";
  cacheTag("roadmap-vote-tallies");
  cacheLife("minutes");
  try {
    const res = await fetch(`${APP_URL}/api/roadmap-vote`);
    if (!res.ok) return EMPTY_TALLIES;
    return (await res.json()) as RoadmapVoteResponse;
  } catch {
    return EMPTY_TALLIES;
  }
};
```

Après :

```ts
const fetchTallies = async (): Promise<RoadmapVoteResponse> => {
  "use cache";
  cacheTag("roadmap-vote-tallies");
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 });
  try {
    // Direct call, not fetch(APP_URL + "/api/roadmap-vote"): the route handler adds nothing
    // that this page needs (roadmap-vote/route.ts:72-83 is a getTallies() wrapper), and the
    // round trip cost one extra edge request plus one extra function invocation per render.
    return await getTallies();
  } catch {
    return EMPTY_TALLIES;
  }
};
```

Ajouter `import { getTallies } from "@/lib/roadmap-vote";` dans le bloc interne des imports. `APP_URL` reste utilisé par les métadonnées Open Graph lignes 24, 27 et 34, ne pas le supprimer.

**Pièges** : aucun. `getTallies()` ne lit aucun header, ne renvoie pas de `NextResponse`, et le `catch` conserve exactement la même sémantique de repli sur `EMPTY_TALLIES`.

**Changement de sémantique à connaître** : aujourd'hui une erreur 500 dans la route renvoie `res.ok === false` et la page tombe sur `EMPTY_TALLIES` sans que rien ne soit journalisé côté page. Après extraction, une exception Prisma remonte dans le `catch` de la page, toujours vers `EMPTY_TALLIES`, mais la ligne `logError("roadmap-vote GET", err)` de la route n'est plus émise pour ce chemin. Si on veut garder la trace, ajouter `logError("roadmap page tallies", err)` dans le `catch`. Je le recommande, ça coûte une ligne et un `catch` muet est précisément ce que `.claude/rules/defensive-code-audit.md` interdit.

**Tests** : `src/app/api/roadmap-vote/__tests__/route.test.ts` (249 lignes) teste la route, pas la page. Aucun test cassé, la route reste inchangée. Aucun test neuf, le comportement de `getTallies` est déjà couvert par `src/lib/roadmap-vote.test.ts` (mentionné dans le commentaire à `roadmap-vote.ts:19`).

### 5.3 Ordre 2, explore

`src/app/api/explore/route.ts:16-61` fait trois requêtes en `Promise.all` et emballe le résultat dans un `ExploreSummary`. Aucun header lu, aucun paramètre.

Nouveau fichier `src/lib/explore-query.ts` : y déplacer le type `ExploreSummary` et le corps du handler, sous la forme `export const fetchExploreSummary = async (): Promise<ExploreSummary> => { ... }`, sans le `try/catch` (l'erreur remonte à l'appelant).

La route devient un wrapper :

```ts
export const GET = async () => {
  try {
    const data = await fetchExploreSummary();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
    });
  } catch (err) {
    logError("explore", err);
    return jsonError("internal", 500);
  }
};
```

**Piège de propagation de types.** `ExploreSummary` est importé depuis la route par `src/app/explore/page.client.tsx:23` et `src/app/explore/page.tsx:5`. Ne pas casser ces imports : garder dans la route `export type { ExploreSummary } from "@/lib/explore-query";`. C'est exactement ce que fait déjà `src/app/api/repos/route.ts:10` pour `MappedRepo`, le repo a le précédent.

La page devient :

```ts
const fetchSummary = async (): Promise<ExploreSummary | null> => {
  "use cache";
  cacheTag("explore-mvs");
  cacheLife({ revalidate: 3600, stale: 86400 });
  try {
    return await fetchExploreSummary();
  } catch {
    return null;
  }
};
```

**Piège de cache, celui-ci est important.** L'appel actuel utilise `next: { revalidate: 3600, tags: ["explore-summary"] }` sur le `fetch()` (`explore/page.tsx:12`). Ce n'est **pas** un `"use cache"` : c'est le data cache de `fetch`, avec un tag `explore-summary` qui, comme `repo-stats-*`, n'est invalidé nulle part. En passant à `"use cache"`, il faut choisir un tag. Le bon choix est **`explore-mvs`**, déjà utilisé par `devs-query.ts:40`, `:92` et `:110`, et déjà invalidé par `refresh-grid-mv/route.ts:96`. Les données de `ExploreSummary` viennent de `country_stats_mv` et de `pg_class.reltuples`, exactement le périmètre rafraîchi par ce cron toutes les 4 heures (`vercel.json:7-10`). Reprendre `explore-summary` reconduirait un tag mort.

**Tests** : `src/app/api/explore/__tests__/route.test.ts` (93 lignes) importe `GET` et mocke `@/lib/db`. Le mock de `@/lib/db` reste valide puisque `explore-query.ts` importe le même module. **Aucun test cassé**, à condition de garder les mêmes codes de statut et le même en-tête `Cache-Control` dans le wrapper. Un test neuf dans `src/lib/__tests__/explore-query.test.ts` : vérifier le repli sur le `DISTINCT` scan quand `country_stats_mv` lève (le `.catch()` de `route.ts:31`), qui n'est aujourd'hui couvert que par le test de la route.

### 5.4 Ordre 3, profil

`src/app/api/profile/[login]/route.ts:39-214`. Le handler ne lit rien de `_req` (le paramètre est préfixé d'un underscore, c'est le signal). Il a deux chemins de sortie normaux (profil partiel 206-like en 200, profil complet) et deux erreurs (400 `invalid_params`, 404 `not_found`).

Nouveau fichier `src/lib/profile-query.ts` avec un type de retour discriminé :

```ts
export type ProfileResult =
  | { ok: true; profile: ProfileResponse }
  | { ok: false; error: "invalid_params"; status: 400 }
  | { ok: false; error: "not_found"; status: 404 };

export const fetchProfile = async (login: string): Promise<ProfileResult> => { ... };
```

La route se réduit à :

```ts
export const GET = async (_req: NextRequest, { params }: { params: Promise<{ login: string }> }) => {
  const { login } = await params;
  try {
    const result = await fetchProfile(login);
    if (!result.ok) return jsonError(result.error, result.status);
    return NextResponse.json(result.profile, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("profile", err);
    return jsonError("internal", 500);
  }
};
```

**Piège de sémantique d'erreur, à ne pas rater.** Le type discriminé est la seule forme correcte. Renvoyer `ProfileResponse | null` écraserait la distinction entre 400 et 404, et la page ne pourrait plus la restituer. Ce n'est pas un détail cosmétique : `/profile/{login}` avec un login malformé doit rester un 400.

**Piège de types** : `ProfileResponse` et `ProfileRepo` sont importés depuis la route par `src/app/profile/[login]/page.client.tsx:17` et `page.tsx:7`. Même remède, réexport depuis la route.

**Tests** : il n'y a pas de `__tests__` sur `src/app/api/profile/[login]/route.ts` (seulement sur `refresh/`). Rien ne casse, et c'est justement l'occasion d'en écrire : un fichier `src/lib/__tests__/profile-query.test.ts` couvrant le login invalide (400), le login inconnu (404), le chemin partiel propriétaire de repo, le chemin complet, et l'enrichissement `badge_cache` des repos étoilés. Cinq tests, mocking `@/lib/db` sur le modèle de `stats/__tests__/route.test.ts:13-19`.

### 5.5 Ordre 4, stats. Le plus gros gain, le plus de pièges

C'est le seul des cinq qui touche la page la plus fréquentée, et le seul dont le handler fait 340 lignes.

Nouveau fichier `src/lib/repo-stats-query.ts`. Y déplacer `RepoOrganic`, `RepoStats`, `RepoStatsMvRow`, `isNeonTimeout` et tout le corps du handler, sous :

```ts
export type RepoStatsResult =
  | { ok: true; stats: RepoStats; cacheControl: string }
  | { ok: false; error: "invalid_params" | "no_data"; status: 400 | 404 };

export const computeRepoStats = async (owner: string, repo: string): Promise<RepoStatsResult> => { ... };
```

Le `cacheControl` doit remonter dans le résultat, pas rester dans la route. La logique qui le calcule (`stats/route.ts:407-411`) dépend de `partial` et de `source`, deux valeurs internes. La dupliquer dans la route serait une violation directe de `.claude/rules/code-duplication.md`.

Route réduite :

```ts
export const maxDuration = 30;

export const GET = async (_req: NextRequest, { params }: { params: Promise<{ owner: string; repo: string }> }) => {
  const { owner, repo } = await params;
  try {
    const result = await computeRepoStats(owner, repo);
    if (!result.ok) return jsonError(result.error, result.status);
    return NextResponse.json(result.stats, { headers: { "Cache-Control": result.cacheControl } });
  } catch (err) {
    logError("stats", err);
    return jsonError("internal", 500);
  }
};
```

Page, `src/app/[owner]/[repo]/page.tsx:38-59` :

```ts
const fetchStats = async (owner: string, repo: string): Promise<RepoStats | null> => {
  "use cache";
  cacheTag(`repo-stats-${owner}-${repo}`);
  cacheLife({ stale: 300, revalidate: 600, expire: 86400 });
  try {
    const result = await computeRepoStats(owner, repo);
    if (!result.ok) return null;
    // cacheLife keeps the minimum per field (cache-life.js:143-160), so this can only shorten.
    if (result.stats.isPartial) cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return result.stats;
  } catch {
    return null;
  }
};
```

**Les cinq pièges, dans l'ordre de gravité.**

**1. `maxDuration`.** `stats/route.ts:12` déclare `export const maxDuration = 30`. Une fois `computeRepoStats` appelée depuis `page.tsx`, c'est le budget de la **page** qui s'applique, et `page.tsx` n'en déclare aucun. La requête `power-users` est mesurée à 2.3 à 2.6 s à froid (commentaire `stats/route.ts:288-295`) et la jointure `totals` peut aller jusqu'au `statement_timeout` de Neon. **Ajouter `export const maxDuration = 30;` dans `src/app/[owner]/[repo]/page.tsx`.** Sans ça, un repo lent qui passait aujourd'hui devient un timeout de page.

Nuance honnête : aujourd'hui le `fetch()` de `page.tsx:43` n'a pas de timeout, donc la page attend déjà la route jusqu'à ses 30 s. L'exposition existe. La déclaration explicite la rend visible plutôt qu'implicite.

**2. Le type `RepoStats` est importé par 9 fichiers.**

```
src/app/[owner]/[repo]/page.client.tsx:24    (RepoStats, RepoOrganic)
src/app/[owner]/[repo]/page.tsx:8
src/components/map/share-modal.tsx:11
src/components/map/stats-modal.tsx:11
src/components/map/stats-modal.test.tsx:7
src/hooks/useScanController.ts:6
src/hooks/use-repo-cache-loader.ts:12
```

Réexporter depuis la route est obligatoire : `export type { RepoStats, RepoOrganic } from "@/lib/repo-stats-query";`. Sinon le diff explose sur sept fichiers dont un test, en violation de la règle 5 de `universal-rules.md`.

**3. `REPO_STATS_MV_ENABLED` doit rester lu à l'intérieur de la fonction.** Le commentaire `stats/route.ts:112-115` explique pourquoi : une constante de module gèle au cold start, ce qui casse le rollback sans déploiement et rend `vi.stubEnv` inopérant. Déplacer le code sans déplacer cette contrainte serait une régression silencieuse. Le `const mvEnabled = process.env.REPO_STATS_MV_ENABLED === "true";` reste dans le corps de `computeRepoStats`.

**4. La séquence d'appels `$queryRaw` ne doit pas bouger d'un cran.** `stats/__tests__/route.test.ts:79-83` mocke quatre `$queryRaw` **par position** :

```ts
mockQueryRaw
  .mockResolvedValueOnce([totalsRow])                                  // totals JOIN
  .mockResolvedValueOnce([{ location: "Paris, France", cnt: 100n }])   // locationRows
  .mockResolvedValueOnce([{ company: "Google", cnt: 50n }])            // companyRows
  .mockResolvedValueOnce([]);                                          // crossRepoGroups
```

Le commentaire `stats/route.ts:117-119` dit déjà que toute requête supplémentaire décalerait ces quatre mocks. L'extraction ne doit rien ajouter, rien réordonner, rien fusionner. C'est une extraction mécanique, pas une refonte.

**5. La perte du cache CDN sur ce chemin.** Aujourd'hui l'auto-appel HTTP traverse le CDN Vercel et peut tomber sur un hit `s-maxage=300` ou `s-maxage=900` (chemin `precomputed`). Après extraction, le SSR interroge Neon directement à chaque miss `"use cache"`. Ce n'est pas une régression nette (la fenêtre `"use cache"` passe à 600 s et l'entrée est partagée entre tous les visiteurs de ce repo), mais ça déplace de la charge du CDN vers Neon. Point à surveiller sur le compteur de requêtes Neon 48 h après déploiement. Le cache CDN de la route reste alimenté par les fetches client de `useScanController.ts:244` et `use-repo-cache-loader.ts:242`, il ne devient pas froid.

**Tests** : les 450 lignes de `stats/__tests__/route.test.ts` importent `GET` et assertent sur `res.status`, le corps JSON et l'en-tête `cache-control`. Tant que le wrapper préserve les trois, **zéro test cassé**. C'est le critère de conception de l'extraction, pas un effet de bord heureux : si un test casse, c'est que l'extraction a changé un comportement et il faut revenir en arrière, pas ajuster le test.

Tests neufs, dans `src/lib/__tests__/repo-stats-query.test.ts`, deux seulement, sur ce que le découpage rend testable et qui ne l'était pas :

```ts
it("returns cacheControl s-maxage=30 when the result is partial", ...)
it("returns cacheControl s-maxage=900 on the precomputed path", ...)
```

Ces deux-là valaient déjà par la route, mais les avoir au niveau de la fonction verrouille le contrat de `RepoStatsResult`.

### 5.6 Ordre 5, repo-info. Je déconseille

C'est le seul des cinq que je sors de la liste, et l'audit ne signale pas pourquoi.

`src/app/api/repo-info/route.ts:15` fait `const token = extractGhToken(req)`, et `api-helpers.ts:83-84` :

```ts
export const extractGhToken = (req: NextRequest): string | undefined =>
  req.headers.get("x-gh-token") || process.env.GITHUB_TOKEN || undefined;
```

**Le handler consomme un header de requête.** C'est précisément le cas que le lead demandait de signaler. Extraire proprement suppose de faire remonter le token en paramètre, donc de changer la signature, donc de décider ce que la page passe. La page n'a pas de token utilisateur (le PAT vit dans le `localStorage` du navigateur, `token-modal.tsx`), elle passerait donc `undefined` et la fonction retomberait sur `process.env.GITHUB_TOKEN`. Fonctionnellement correct, mais on crée une fonction à deux modes dont un seul est utilisé par l'appelant qu'on veut optimiser.

Deuxième objection, plus décisive. Ce handler ne touche pas Neon : il appelle `api.github.com` deux fois (`route.ts:22` et `:35`). Le premier appel porte `next: { revalidate: 300, tags: [...] }`, donc il bénéficie du data cache Next. Le second, celui des contributeurs, n'a **aucune** directive de cache : il repart vers GitHub à chaque invocation. Supprimer l'auto-appel HTTP ne change rien à ça ; ça remplace une invocation de fonction par rien, mais l'appel GitHub non caché reste, et c'est lui qui coûte la latence et le quota.

Le vrai correctif sur ce fichier est ailleurs et il fait une ligne : ajouter `next: { revalidate: 3600, tags: [\`repo-info-${owner}-${repo}\`] }` sur le fetch des contributeurs ligne 37. Le nombre de contributeurs d'un repo ne change pas toutes les 5 minutes, et ça supprime un aller-retour GitHub par rendu.

**Recommandation** : sortir repo-info de l'item 15, et faire à la place le correctif de cache sur le fetch contributeurs. Gain sur la facture Vercel : marginal. Gain sur la latence de rendu et le quota GitHub : réel. À ranger dans le lot `github` ou `api`, pas dans le lot d'extraction.

Diff proposé, `src/app/api/repo-info/route.ts:35-38` :

```diff
     const contribRes = await fetch(
       `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=0`,
-      { headers: ghHeaders },
+      // Unlike the core fetch on line 22, this one had no cache directive at all: it went
+      // back to GitHub on every single invocation. A contributor count does not move on a
+      // 5-minute scale, and the tag lets badge-update flush it on scan completion.
+      { headers: ghHeaders, next: { revalidate: 3600, tags: [`repo-info-${owner}-${repo}`] } },
     ).catch(() => null);
```

Attention : ce `fetch` est suivi de `parseGitHubCountFromLink(contribRes)` qui, dans la branche sans en-tête `Link`, consomme le corps avec `res.json()` (`api-helpers.ts:126`). Un corps de réponse déjà consommé lève. Le data cache Next renvoie une `Response` fraîche à chaque hit, donc c'est sûr, mais c'est le genre de détail qui mérite le test.

**Test neuf** dans `src/app/api/repo-info/__tests__/route.test.ts` (213 lignes, existe) :

```ts
it("passes a revalidate directive on the contributors fetch", async () => {
  // spy sur global.fetch, inspecter le second appel
  expect(fetchSpy.mock.calls[1][1]).toMatchObject({ next: { revalidate: 3600 } });
});
```

### 5.7 Chiffrage global de l'item 15

L'audit annonce $1.20/mois. Reconstruction du chiffre par poste, sur les quatre extractions retenues.

Chaque auto-appel supprimé retire, par rendu, une Edge Request, une Function Invocation, un aller-retour TLS et un transfert origine du payload compté deux fois. Sur la facture, ça touche Function Invocations ($0.78 sur la période, $0.38/mois), Fluid Active CPU ($4.07, $2.00/mois) et Fluid Provisioned Memory ($4.00, $1.96/mois), soit $4.34/mois de base.

Les quatre extractions retenues couvrent les routes servant `/[owner]/[repo]` (deux appels, la page la plus fréquentée), `/explore` (2.1k req/24 h) et `/profile/[login]`. Si elles représentent un quart des invocations, le gain est de $1.09/mois ; un tiers, $1.45/mois. **Fourchette $1.10 à $1.45/mois**, cohérente avec l'audit.

Le gain qui ne se voit pas sur la facture compte au moins autant : la page repo passe de trois invocations de fonction pour une requête utilisateur à une seule, et le rendu perd deux allers-retours TLS complets sur son chemin critique.

---

## 6. Item 16 : le contrat client de `stargazer-cache`

Verdict tranché, comme demandé.

### 6.1 Les consommateurs, tous

`GET /api/stargazer-cache/[owner]/[repo]` a exactement **un** consommateur applicatif, plus onze tests.

| Site | Ce qu'il fait |
|---|---|
| `src/hooks/use-repo-cache-loader.ts:150` | seul appelant en production |
| `src/hooks/use-repo-cache-loader.test.ts` lignes 110, 130, 147, 158, 170, 191, 208, 228, 245, 264, 278, 294 | 12 mocks de cette route |
| `src/lib/proxy.test.ts:123` | classification de tier, insensible au format |

`src/app/api/mcp/points/[owner]/[repo]/route.ts` lit la même table mais c'est une route distincte avec son propre format, elle ne consomme pas celle-ci. Le commentaire `mcp/points/route.ts:9-13` documente d'ailleurs les différences.

Ce que `use-repo-cache-loader.ts:150-196` attend :

```ts
if (r.status === 304) return;                     // ETag, ligne 151
if (r.status === 206) { d.lastScan }              // ligne 156-164
const data = await r.json();                      // ligne 175
data.points, data.unmapped, data.totalCount,      // lignes 176-196
data.scannedAt, data.latestStarredAt
```

### 6.2 Ce qui casse si on renvoie le blob gzip tel quel

Quatre choses, dont une bloquante.

**1. La réduction de précision géographique disparaît. Bloquant.** `route.ts:58-65` arrondit `lat` et `lng` à deux décimales, avec le commentaire « prevent individual geolocation ». Le blob en base est **fourni par le client** sans arrondi : `stargazer-cache/route.ts:106-113` stocke `body.pointsGz` tel quel sur le chemin moderne, sans jamais le décompresser ni le valider. Renvoyer le blob brut, c'est publier des coordonnées à pleine précision. La même mesure est reprise indépendamment dans `mcp/points/route.ts:108-110`, ce qui confirme que c'est un contrôle assumé et non un reliquat. Vu le travail RGPD et la DPIA du projet, retirer un contrôle de minimisation pour économiser du transfert n'est pas un arbitrage acceptable sans décision explicite.

**2. L'enveloppe est perdue.** Le blob ne contient que `points`. La réponse porte cinq champs, dont `totalCount`, `scannedAt` et `latestStarredAt` qui viennent de colonnes séparées et que le hook lit lignes 179 à 195. Renvoyer un seul blob obligerait à déplacer ces valeurs dans des en-têtes personnalisés, à changer le hook et à réécrire les douze mocks.

**3. `Content-Encoding: gzip` posé à la main est risqué en aveugle.** Si la plateforme recompresse, on obtient un double encodage. Si un intermédiaire décompresse sans retirer l'en-tête, le client reçoit du binaire. Ça se maîtrise (voir §6.3), mais pas en renvoyant un blob dont le format ne correspond même plus au type de contenu annoncé.

**4. `avatarUrl` disparaît.** La reconstruction ligne 61 n'est pas décorative : elle existe parce que `stargazer-cache/route.ts:120` supprime `avatarUrl` à l'écriture sur le chemin legacy pour gagner de la place. Le client s'attend à le trouver.

### 6.3 Ce qu'il faut faire à la place

Garder l'enveloppe JSON, garder l'arrondi, garder `avatarUrl`, et **compresser la réponse dans le handler**, sous condition d'`Accept-Encoding`.

C'est la version de l'item 16 qui vaut le coup, et elle devient prioritaire parce que l'item 9 ne peut rien (§0.1). Sur un payload JSON de stargazers, le ratio mesuré est de 6 à 20× selon la répétitivité. Le coût CPU est négligeable devant le transfert évité : gzip d'un payload de 15 MB à environ 30 MB/s coûte 0.5 s de Fluid Active CPU, soit $0.00002 à $0.145/h, contre 14 MB de transfert origine évités, soit $0.00095 à $0.068/GB. **Le rapport est de 1 à 50 en faveur de la compression.**

Diff, `src/app/api/stargazer-cache/[owner]/[repo]/route.ts:67-76`.

Avant :

```ts
    return NextResponse.json(
      {
        points: pointsWithAvatar,
        unmapped,
        totalCount: cached.totalCount,
        scannedAt: cached.scannedAt.toISOString(),
        latestStarredAt: cached.latestStarredAt?.toISOString() ?? null,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600", ETag: etag } },
    );
```

Après :

```ts
    const body = JSON.stringify({
      points: pointsWithAvatar,
      unmapped,
      totalCount: cached.totalCount,
      scannedAt: cached.scannedAt.toISOString(),
      latestStarredAt: cached.latestStarredAt?.toISOString() ?? null,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      // Mandatory: the CDN caches this response for 300s, and an identity client must not
      // be served a cached gzip body (nor the reverse).
      Vary: "Accept-Encoding",
      ETag: etag,
    };

    // The envelope, the 2-decimal rounding on lines 62-64 and the avatarUrl reconstruction
    // all stay. Only the transport changes. Returning the stored blob verbatim would drop
    // the rounding, which is a data-minimisation control, not an optimisation: the blob is
    // written client-side unvalidated (stargazer-cache/route.ts:106-113).
    //
    // Gated on Accept-Encoding rather than unconditional: a client that asked for identity
    // gets identity. Every browser and every runtime this hook runs in sends gzip.
    if (_req.headers.get("accept-encoding")?.includes("gzip")) {
      const gz = gzipSync(Buffer.from(body, "utf8"));
      return new NextResponse(new Uint8Array(gz), {
        headers: { ...headers, "Content-Encoding": "gzip" },
      });
    }

    return new NextResponse(body, { headers });
```

Ajouter `import { gzipSync } from "zlib";` en tête. Renommer `_req` en `req` puisqu'il est désormais lu deux fois (déjà lu ligne 42 pour `if-none-match`, l'underscore était donc déjà trompeur).

**Ce qui ne change pas pour le client** : `use-repo-cache-loader.ts:175` fait `await r.json()`. `fetch()` décompresse `Content-Encoding: gzip` de façon transparente dans tous les navigateurs et dans undici. Le hook n'a **aucune** modification à subir. C'est ce qui distingue cette version de celle de l'audit.

**Vérification à faire en preview avant de merger**, parce que je ne peux pas la faire depuis ici. Deux commandes, elles couvrent les deux modes de défaillance.

```bash
# 1. Pas de double encodage : --compressed doit rendre du JSON lisible, pas du binaire.
curl -s --compressed 'https://<preview>/api/stargazer-cache/facebook/react' | head -c 200

# 2. Le CDN sert bien deux variantes. Deux appels, l'un gzip l'autre identity,
#    dans cet ordre, en confirmant que le second n'est pas du binaire.
curl -sI -H 'Accept-Encoding: gzip'     'https://<preview>/api/stargazer-cache/facebook/react' | grep -i 'content-encoding\|vary\|x-vercel-cache'
curl -s  -H 'Accept-Encoding: identity' 'https://<preview>/api/stargazer-cache/facebook/react' | head -c 200
```

Le second test est celui qui compte : c'est lui qui prouve que le `Vary: Accept-Encoding` fait son travail. Sans lui, un client identity peut recevoir la variante gzip mise en cache par le CDN, et ce pendant les 300 secondes du `s-maxage`.

**Tests** : les douze mocks de `use-repo-cache-loader.test.ts` construisent des `Response` via un helper `jsonResponse`, sans en-tête `Accept-Encoding` dans la requête. La branche gzip ne sera donc pas empruntée en test. **Aucun test cassé.**

Trois tests neufs dans `src/app/api/stargazer-cache/[owner]/[repo]/__tests__/route.test.ts` :

```ts
it("returns gzip when the client advertises it", async () => {
  // NextRequest avec header accept-encoding: gzip
  expect(res.headers.get("content-encoding")).toBe("gzip");
  expect(res.headers.get("vary")).toBe("Accept-Encoding");
});

it("returns identity JSON when the client does not advertise gzip", async () => {
  expect(res.headers.get("content-encoding")).toBeNull();
  expect((await res.json()).totalCount).toBe(42);
});

it("keeps lat/lng rounded to 2 decimals inside the gzip body", async () => {
  // gunzipSync sur res.arrayBuffer(), puis JSON.parse
  // point 48.856614 → 48.86
});
```

Le troisième est le plus important des trois : c'est celui qui empêchera quelqu'un de « simplifier » plus tard en renvoyant le blob brut.

Le helper `makeReq` du fichier de test accepte déjà des en-têtes (`route.test.ts:47-49`), il suffit de lui ajouter un paramètre `acceptEncoding`.

### 6.4 La même technique s'applique à `/api/repos`

Une fois le pattern posé, `/api/repos` en profite : 1.31 MB de JSON pour `limit=5000`, 218 KB en gzip (mesuré, §0.4). Même diff, mêmes trois lignes, même `Vary: Accept-Encoding` (obligatoire ici, la route porte `s-maxage=300`).

À faire dans le même commit que `stargazer-cache`, et à ce moment-là il faut extraire un helper plutôt que de dupliquer, sous peine de violer `.claude/rules/code-duplication.md`. Proposition : `src/lib/api-helpers.ts` reçoit

```ts
/** JSON response, gzip-encoded when the client advertises support. Always sets Vary. */
export const jsonMaybeGzip = (
  req: NextRequest,
  value: unknown,
  headers: Record<string, string> = {},
): NextResponse => { ... };
```

Cinq routes candidates au total, par taille de payload décroissante : `stargazer-cache/[owner]/[repo]`, `repos`, `mcp/points/[owner]/[repo]` (jusqu'à 10 000 points), `reconstruct/[owner]/[repo]`, `engaged/[owner]/[repo]`. Faire les deux premières, mesurer, décider pour les trois autres.

---

## 7. Trois postes que l'audit n'a pas couverts

Le lead demandait de chercher. Trois trouvailles, dont une qui change probablement le diagnostic de la section 1 de l'audit.

### 7.1 Le proxy pose un `Set-Cookie` sur les assets statiques

`src/proxy.ts:535-540` :

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
```

Trois exclusions seulement. Tout le reste passe par la branche non-API de `proxy.ts:408-428`, qui pour chaque requête génère un nonce, construit une CSP complète (`buildCsp`, 15 directives), vérifie le cookie HMAC et, **s'il est absent ou invalide, pose un `Set-Cookie`**.

Les chemins concernés qui n'ont rien à faire là :

| Chemin | Poids | Pourquoi c'est un problème |
|---|---|---|
| `/world-110m.json` | **105 KB** | fetché par `country-choropleth.tsx:64` et `language-choropleth.tsx:143` |
| `/logo512.png`, `/logo-dark-512.png` | 26 à 29 KB | manifeste PWA (`manifest.ts:17-20`) |
| `/opengraph-image` et `/[owner]/[repo]/opengraph-image` | 50 à 150 KB | crawlers sociaux |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | petits mais très crawlés | |
| les 8 autres SVG et PNG de `public/` | 0.1 à 12 KB | |

Un client sans cookie, c'est-à-dire **tout bot**, reçoit un `Set-Cookie` sur chacune de ces réponses. Une réponse portant `Set-Cookie` n'est pas mise en cache par un CDN dans le comportement standard. Si Vercel applique cette règle, chaque requête bot sur `/world-110m.json` tire 105 KB depuis l'origine au lieu du cache edge. C'est un candidat sérieux pour une part des 91 GB que l'audit n'a attribuée à personne.

Mécanisme documenté mais **non vérifié en production** : à confirmer par `curl -sI https://starmapper.bruniaux.com/world-110m.json` et lecture de `x-vercel-cache` et `set-cookie`. Si `x-vercel-cache: MISS` revient systématiquement, c'est confirmé.

Correctif proposé, `src/proxy.ts:535-540` :

```ts
export const config = {
  matcher: [
    // Excludes Next internals plus every static asset extension. The non-API branch
    // (proxy.ts:408) mints a nonce, builds a full CSP and sets an HMAC cookie on every
    // response it touches: none of that means anything on a PNG, and a Set-Cookie header
    // makes the response uncacheable at the CDN, so every cookie-less client (i.e. every
    // bot) pulled public/world-110m.json (105 KB) from the origin.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|json|txt|xml|webmanifest)$).*)",
  ],
};
```

**Pièges à vérifier avant de merger, il y en a deux.**

D'abord, le motif `\\.json$` exclut aussi `/api/...` si une route API se terminait par `.json`. Il en existe une : `/api/feed/[login]/json` (répertoire `src/app/api/feed/[login]/json/`). Elle ne se termine pas par `.json` (pas de point), donc elle n'est pas capturée. À reconfirmer par un test.

Ensuite, `src/lib/proxy.test.ts` teste `classifyRoute` et `routeKey`, pas le matcher. Le matcher n'est pas testable en unitaire, c'est une chaîne consommée par le build. La vérification est manuelle : après déploiement, `curl -sI` sur `/logo512.png` et confirmer l'absence de `set-cookie` et de `content-security-policy`.

**Ordre de grandeur du gain** : indéterminé sans la mesure. Si `/world-110m.json` prend ne serait-ce que 1 % des 40.1k requêtes/24 h, ça fait 400 × 105 KB = 42 MB/jour, soit 2.6 GB sur la période, $0.18. Si c'est 10 %, c'est $1.80. La mesure d'abord.

### 7.2 Les images OpenGraph n'ont aucune directive de cache et un espace de chemins non borné

`src/app/[owner]/[repo]/opengraph-image.tsx:7-9` déclare `runtime = "edge"`, 1200×630, PNG. Aucun `revalidate`, aucun `dynamicParams`. Le `fetch()` vers `api.github.com` ligne 19 n'a **aucune** option `next` : il repart chez GitHub à chaque rendu.

Conséquence : chaque URL `/{owner}/{repo}` inventée par un crawler social déclenche un rendu `ImageResponse` complet, un appel GitHub non caché, et un PNG de 50 à 150 KB en transfert origine. Sur un espace de chemins que `page.tsx:79` n'a jamais validé, c'est un poste qui grossit exactement au rythme du crawl.

Correctif minimal, deux lignes.

Dans `src/app/[owner]/[repo]/opengraph-image.tsx`, après la ligne 9 :

```ts
// Social crawlers hit one OG image per repo path and the path space is unvalidated. Without
// this, every scanner-invented /{owner}/{repo} rendered a fresh ImageResponse plus an
// uncached GitHub call. A repo card is stable for a day; the star count on it is decorative.
export const revalidate = 86400;
```

Et sur le `fetch` ligne 19-21 :

```diff
     const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
       headers: { Accept: "application/vnd.github.v3+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
+      next: { revalidate: 86400 },
     });
```

**Arbitrage à assumer** : `revalidate` transforme chaque image en entrée ISR, donc en écriture facturée sur les chemins uniques. On échange un rendu coûteux non caché contre une écriture bon marché. Sur un chemin réel visité plusieurs fois, c'est gagnant. Sur un chemin poubelle visité une fois, c'est neutre (une écriture au lieu d'un rendu). Le calcul penche du bon côté, mais c'est la règle WAF 5 de l'audit qui règle vraiment le problème, pas ce diff.

`src/app/opengraph-image.tsx` (la racine) est statique, il ne fait aucun fetch. Ajouter `export const revalidate = false;` y est correct et gratuit.

### 7.3 Le fetch contributeurs de `repo-info` n'est pas caché

Déjà traité en §5.6, mais il appartient à cette liste : c'est un appel GitHub par invocation, sur la page la plus fréquentée du site, et l'audit ne le mentionne pas.

---

## 8. Ordre de merge, en huit lots

Chaque lot est autonome et déployable. L'ordre est celui du ratio gain sur risque, à une exception près : le lot 3 est décalé après le lot 2 parce qu'il demande une mesure préalable.

### Lot 1 : `perf(api): borner la cardinalité du cache /api/repos`

Item 14. Un fichier, `src/app/api/repos/route.ts`.

Vérifiable avant merge : `rtk tsc` propre, les 9 tests existants de `repos/__tests__/route.test.ts` toujours verts, les 5 tests neufs verts, `curl 'localhost:3000/api/repos?limit=7'` renvoie exactement 7 lignes, `?limit=abc` ne renvoie pas de 500.

Mesurable après déploiement : rien de direct. C'est une prévention, pas une optimisation. Le seul signal serait l'absence d'un pic d'ISR Writes après une tentative d'abus.

### Lot 2 : `perf(ui): unoptimized sur les 13 avatars next/image`

Item 12. Huit fichiers, treize éditions d'un mot.

Vérifiable avant merge : `rtk tsc`, `pnpm test` (vérifier `stats-modal.test.tsx`), inspection réseau sur `/facebook/react` confirmant l'absence de requêtes `/_next/image`.

Mesurable après déploiement : le compteur **Image Optimization** doit tomber à zéro ou presque sous 24 h, et **Image Optimization Cache Writes** avec lui. C'est le lot dont la preuve est la plus nette. $1.56/mois.

### Lot 3 : `perf(cache): allonger les fenêtres cacheLife et poser les tags manquants`

Items 10 et 11, plus profil et roadmap, plus les deux `revalidateTag` manquants. Six fichiers.

**Préalable obligatoire, avant d'écrire une ligne** : lire `REPO_STATS_MV_ENABLED` en production, puis exécuter la mesure de la §2.5 (recherche de logs sur `stats/totals timeout`, ou la requête SQL sur `repo_stats_mv`). Le résultat ne change pas le diff, il change le chiffre inscrit et l'ouverture éventuelle d'un ticket de suivi.

Vérifiable avant merge : `pnpm build` propre (les valeurs `cacheLife` sont validées au build, un `revalidate > expire` lève `E656`), le test neuf sur `badge-update`, les tests neufs sur `profile/refresh`.

Mesurable après déploiement : **ISR Writes** sur 48 h, c'est la ligne à surveiller. Fourchette attendue selon l'ordre par rapport au WAF, $1.76/mois si le WAF est déjà en place, $5.04/mois sinon. Vérifier aussi qu'une fin de scan rafraîchit bien le panneau de stats pour un second navigateur (test manuel à deux onglets).

### Lot 4 : `perf(ui): supprimer la duplication des 5000 repos sur /repos`

Item 13 volet A. Un fichier, une ligne.

Vérifiable avant merge : Cmd+K fonctionne sur `/repos`, un `GET /api/repos` apparaît au montage, la taille du document `/repos` dans DevTools est divisée par deux.

Mesurable après déploiement : **Fast Origin Transfer**, environ 6 GB de moins sur un mois. $0.41/mois.

### Lot 5 : `perf(api): gzip explicite sur stargazer-cache et repos`

Item 16 réécrit (§6.3 et §6.4). Trois fichiers, dont le helper dans `api-helpers.ts`.

**Préalables**, deux. Valider en preview que Vercel ne double pas l'encodage et que le `Vary` est respecté, avec les commandes de la §6.3. Et calibrer le gain avec `SELECT owner, repo, length(points) FROM stargazer_cache ORDER BY 3 DESC LIMIT 10;`.

**Contrainte de séquencement, la même qu'au lot 8** : ce lot vise Fast Origin Transfer, exactement comme la règle WAF sur l'empreinte JA4. Ne pas déployer les deux dans la même fenêtre de 48 h, sinon aucune des deux économies n'est attribuable.

Vérifiable avant merge : les 3 tests neufs, dont celui qui verrouille l'arrondi lat/lng, les 12 mocks existants de `use-repo-cache-loader.test.ts` toujours verts, un `curl -H 'Accept-Encoding: identity'` en local renvoyant du JSON lisible.

Mesurable après déploiement : **Fast Origin Transfer**. C'est le seul lot qui agit vraiment sur cette ligne, puisque l'item 9 ne le peut pas (§0.1). Gain non chiffrable sans connaître la taille des blobs, mais l'audit place cette route comme la première ligne des 91 GB. Requête de calibrage à passer d'abord :

```sql
SELECT owner, repo, length(points) AS gz_bytes
FROM stargazer_cache ORDER BY 3 DESC LIMIT 10;
```

### Lot 6 : `refactor(api): extraire la logique des routes vers src/lib`

Item 15, quatre extractions sur cinq, dans l'ordre roadmap-vote, explore, profile, stats. Quatre commits distincts dans une seule PR, pour que chacun soit révocable seul.

Vérifiable avant merge : `rtk tsc`, la suite complète verte (les 450 lignes de `stats/__tests__/route.test.ts` sont le juge de paix), les tests neufs sur `explore-query`, `profile-query` et `repo-stats-query`. Et le point qui se rate le plus facilement : `export const maxDuration = 30;` présent dans `src/app/[owner]/[repo]/page.tsx`.

Mesurable après déploiement : **Function Invocations** doit baisser nettement, c'est le compteur le plus lisible sur ce lot. Surveiller en parallèle le nombre de requêtes Neon, qui monte mécaniquement (§5.5 piège 5). $1.10 à $1.45/mois.

### Lot 7 : `perf(config): exclure les assets statiques du matcher proxy`

§7.1. Un fichier, une ligne.

**Préalable** : la mesure `curl -sI` sur `/world-110m.json` et `/logo512.png`, sinon on ne saura pas si le lot a servi.

Vérifiable avant merge : `pnpm dev`, confirmer qu'une page normale reçoit toujours sa CSP et son cookie, et qu'un PNG de `public/` n'en reçoit plus. Confirmer que `/api/feed/octocat/json` n'est pas exclu par erreur.

Mesurable après déploiement : **Edge Requests**, **Fast Origin Transfer**, et le `x-vercel-cache` sur les assets qui doit passer à `HIT`.

### Lot 8 : `chore(config): retirer compress: false, cacher les OG images`

Item 9 (§0.1) plus §7.2. Trois fichiers.

Diff item 9, `next.config.ts:9` :

```diff
 const nextConfig: NextConfig = {
   cacheComponents: true,
-  compress: false,       // (le commentaire de fin de ligne part avec)
   poweredByHeader: false,
```

Vérifiable avant merge : `pnpm build`, rien d'autre.

Mesurable après déploiement : **Fast Origin Transfer, relevé à heure fixe à J-1 et J+1**, référence 1.47 GB/jour. J'annonce $0.00 sur la partie `compress` avec la preuve source en §0.1 ; c'est ce relevé qui me donnera raison ou tort. Ligne plate, j'avais raison, l'audit surestimait de $2.20. Chute nette sous 0.5 GB/jour, j'avais tort et le chiffre de l'audit tient. Dans les deux cas le lot reste déployé, il n'a aucun coût.

**Contrainte de séquencement, elle vaut pour ce lot et pour les lots 4, 5 et 7.** Ne pas déployer dans la même fenêtre de 48 h que la bascule de la règle WAF sur l'empreinte JA4. Elle vise la même ligne de facture : retirer 65 % du trafic fait mécaniquement chuter le transfert origine, et aucune des deux économies ne serait alors attribuable. En cas de régression on ne saurait pas quoi défaire. L'agent infra a posé ce point en section 7.9 de `plan-action-infra.md`, et sa séquence recommandée est WAF à J0 jusqu'à J+2, mesure, puis les lots code à partir de J+3. Cet ordre a un second mérite : le §10 de ce plan chiffre déjà les gains en colonne « après WAF », donc la mesure post-WAF donne la baseline exacte contre laquelle lire les lots code.

L'ordre inverse fonctionne aussi (lots code d'abord, WAF ensuite), auquel cas ce sont les chiffres de la colonne « hors WAF » qui s'appliquent. Ce qui ne fonctionne pas, c'est de mélanger les deux dans la même fenêtre. C'est un arbitrage à trancher une fois, par l'opérateur.

La partie OG images de ce lot, elle, doit se voir sur Fast Origin Transfer si le site prend du trafic social ou de crawl, et elle subit la même contrainte de séquencement.

---

## 9. Ce que je déconseille, avec l'argument

Cinq points, dont deux qui contredisent frontalement le tableau 7.2 de l'audit.

**Item 9, chiffrer $2.20.** Le module de compression n'est référencé par aucun des deux bundles serveur tracés au build, 0 sur 85 fichiers et 0 sur 698 (§0.1). Passer `compress` à `true` ne peut activer du code qui n'est pas expédié. Faire le changement, oui, une seconde et zéro risque. Le compter dans la trajectoire, non. Le relevé de Fast Origin Transfer à J+1 reste inscrit comme test de réfutation, mais l'agent infra, qui portait l'estimation opposée, a retiré la sienne au vu des mêmes traces.

**Item 16 tel que spécifié.** Renvoyer le blob gzip brut supprime l'arrondi à deux décimales de `route.ts:62-64`, qui est un contrôle de minimisation des données, sur un blob écrit par le client sans validation (§6.2). C'est un arbitrage RGPD déguisé en optimisation de transfert. La version §6.3 capture le même gain de bande passante et n'y touche pas.

**Item 15 sur repo-info.** Le handler consomme `x-gh-token` (§5.6), donc l'extraction demande de changer la signature pour un appelant qui passera toujours `undefined`. Et surtout, le vrai coût du fichier n'est pas l'auto-appel, c'est le fetch contributeurs sans cache ligne 35, qui repart chez GitHub à chaque invocation. Faire la ligne de cache, pas l'extraction.

**Item 13 volet B, réduire le tableau à 500.** $0.37/mois de plus, contre la perte du tri sur l'intégralité du corpus, sur une page dont le titre est « All mapped repos ». Le volet A capture $0.41/mois pour une ligne et sans perte. Le volet B mérite sa propre PR avec un tri serveur, pas un raccourci dans un lot de coût (§4.2).

**Item 11 déployé seul.** Sans l'item 10, `min(60, 60) = 60` et la branche `isPartial` devient identique à la branche normale : on perd la protection décrite au commentaire `page.tsx:48-53` sans gagner une écriture (§0.3). Les deux partent ensemble ou aucun ne part.

---

## 10. Récapitulatif chiffré

Les colonnes distinguent ce qui est mesuré de ce qui est estimé. « Mesuré » veut dire que le chiffre vient d'une exécution ou d'une lecture de source, pas d'un raisonnement.

| Lot | Items | $/mois hors WAF | $/mois après WAF | Statut du chiffre |
|---|---|---|---|---|
| 1 | 14 | $0 (prévention) | $0 | méthode mesurée, gain non chiffrable |
| 2 | 12 | **$1.56** | $1.56 | dérivé de la facture, 13 sites recomptés |
| 3 | 10 + 11 | **$5.04** | **$1.76** | modèle explicite, entrées de l'audit |
| 4 | 13 volet A | **$0.41** | $0.41 | payload mesuré localement (1.31 MB) |
| 5 | 16 réécrit | non chiffré | non chiffré | ratio de compression mesuré, volume inconnu |
| 6 | 15 (4 routes sur 5) | **$1.10 à $1.45** | $1.10 à $1.45 | estimation, méthode en §5.7 |
| 7 | proxy matcher | $0.18 à $1.80 | $0.18 à $1.80 | à mesurer avant de s'engager |
| 8 | 9 + OG images | **$0.00** pour le 9 | $0.00 | preuve source en §0.1, falsifiable par relevé J+1 |

**Total défendable hors WAF : $8.11 à $10.26/mois**, plus le lot 5 non chiffré qui est probablement le plus gros de tous puisqu'il attaque la première ligne des 91 GB.

### 10.1 La trajectoire de l'audit se déplace

La section 7.3 du rapport annonce un palier à **$4.50 à $6.00/mois** après les items 9, 10 et 12. L'item 9 valant $0.00 et non $2.20, ce palier remonte à **$6.70 à $8.20/mois**. L'agent infra a soulevé le point, il est juste et il compte pour l'arbitrage.

Deux conséquences pour le lead.

Le centre de gravité se déplace vers le WAF, qui reste le poste dominant à $10 à $12/mois pour 16 minutes de dashboard, et vers mon lot 5, seul levier restant sur les 91 GB de transfert origine.

Et le lot 5 change de statut. Il était classé « modéré, 3 h, à faire seulement si le 9 ne suffit pas » dans le tableau 7.2. Il devient le seul moyen d'agir sur Fast Origin Transfer, donc il monte devant le lot 6 (extraction des routes) en priorité, à effort comparable. Je ne modifie pas l'ordre des lots pour autant : les lots 1 à 4 restent devant parce qu'ils sont plus rapides et sans risque, et le lot 5 demande une mesure de calibrage préalable (`SELECT length(points)` sur `stargazer_cache`) que les autres n'exigent pas.
**Total après application des règles WAF : $4.83 à $6.98/mois**, plus le lot 5.

L'audit annonçait $7.96/mois hors items 11 et 17. L'écart tient à trois choses : le retrait des $2.20 de l'item 9, l'ajout du lot 7, et la revalorisation du lot 5 qui devient le seul levier restant sur le transfert origine.

---

## 11. Mesures à faire avant de coder, dans l'ordre

Six mesures, aucune n'exige de déploiement ni d'écriture.

1. `vercel env ls` puis lecture de `REPO_STATS_MV_ENABLED`. Commande le périmètre de la mesure suivante. Bloque le lot 3.
2. Recherche de logs Vercel sur `stats/totals timeout` sur 24 h, ou la requête SQL de la §2.5 si le flag est actif. Chiffre l'item 11. Bloque le lot 3.
3. ~~`curl -sI -H 'Accept-Encoding: gzip'` sur `/api/repos` et `/api/map-image/*`.~~ **Retiré.** Cette mesure ne peut rien trancher : elle observe le segment edge vers client, alors que `compress` agirait sur le segment fonction vers edge (§0.1). Remplacée par un relevé de **Fast Origin Transfer à J-1 et J+1 du lot 8**, à heure fixe, référence 1.47 GB/jour. Ne pas la faire dans la même fenêtre de 48 h que la règle WAF JA4, voir la contrainte de séquencement du lot 8.
4. `curl -sI https://starmapper.bruniaux.com/world-110m.json`, lecture de `set-cookie` et `x-vercel-cache`. Chiffre le lot 7.
5. `SELECT owner, repo, length(points) FROM stargazer_cache ORDER BY 3 DESC LIMIT 10;` Calibre le lot 5.
6. `SELECT count(*) FROM badge_cache bc WHERE EXISTS (SELECT 1 FROM stargazer_cache sc WHERE sc.owner = bc.owner AND sc.repo = bc.repo);` Dit si le problème de l'item 13 est bien de 5 000 lignes ou de beaucoup moins.

Les lots 1, 2 et 4 ne dépendent d'aucune de ces mesures. Ils peuvent partir immédiatement, pour $1.97/mois cumulés et environ 45 minutes de travail.
