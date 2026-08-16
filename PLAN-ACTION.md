# Plan d'action StarMapper : coût Vercel et trafic illégitime

**Date** : 2026-08-16
**Point de départ** : $44.52 d'infra sur 62 jours, soit **$21.82/mois**, plus l'abonnement Pro.
**Statut** : plan validé, rien n'est encore appliqué.

Ce fichier est l'index et le séquencement. Le détail vit dans trois documents :

| Document | Contenu |
|---|---|
| `research-vercel-cost-audit.md` | L'audit d'origine, 44 % de la facture attribués aux ISR Writes |
| `plan-action-infra.md` | Les 7 règles WAF, le protocole de mesure, le rollback, l'audit des crons |
| `plan-action-code.md` | Les 8 lots de code, diffs exacts, tests, 5 corrections à l'audit |

---

## 1. Ce qui a changé depuis l'audit

Trois corrections modifient la trajectoire. Elles sont toutes prouvées par lecture de source ou par mesure, pas par raisonnement.

**L'item 9 vaut $0.00, pas $2.20.** Retirer `compress: false` de `next.config.ts:9` ne peut rien rapporter sur Vercel. Dans Next 16.2.12, l'option n'est lue qu'à un seul endroit, `node_modules/next/dist/server/lib/router-server.js:115`, qui est le serveur HTTP de `next start`. Les traces de build `.nft.json` montrent que le module `compression` n'est référencé dans aucun des deux bundles serveur, 0 sur 85 fichiers et 0 sur 698. Le code n'est pas expédié, le flag ne peut donc rien activer. Fais le changement quand même, il coûte une seconde et restaure la valeur par défaut, mais ne le compte pas.

**Le curl que j'avais recommandé ne tranche rien.** Fast Origin Transfer facture le segment fonction vers edge. Un curl client observe le segment edge vers client, que le CDN recompresse toujours. Le seul instrument qui voit le bon segment est le compteur de facturation, relevé à heure fixe avant et après.

**Le seul levier restant sur les 91 GB est la compression explicite dans les handlers.** Le lot 5 passe donc de « à faire si le 9 ne suffit pas » à « seul moyen d'agir sur ce poste ».

Trajectoire corrigée :

| Palier | Infra $/mois | Cumul économisé |
|---|---|---|
| Aujourd'hui | 21.82 | 0 |
| Après WAF (J+2) | 11 à 14 | 8 à 11 |
| Après WAF stabilisé (J+7) | 9 à 12 | 10 à 13 |
| Après lots code 1 à 4 | 7 à 10 | 12 à 15 |
| Après lots 5 à 8 | 5 à 8 | 14 à 17 |

L'incertitude cumulée est de plus ou moins $3. Deux inconnues la portent, nommées en section 6.

---

## 2. La règle qui gouverne tout le séquencement

**Ne jamais déployer une règle WAF et un lot de code dans la même fenêtre de 48 heures.**

Les deux mordent sur les mêmes lignes de facture, ISR Writes et Fast Origin Transfer. Lâchés ensemble, aucune économie n'est attribuable, et en cas de régression tu ne sais pas quoi défaire.

L'ordre retenu est WAF d'abord. Deux raisons. Le WAF rapporte le plus pour le moins d'effort, environ $10 pour 16 minutes de dashboard. Et une fois le trafic bot coupé, la mesure post-WAF donne la baseline exacte contre laquelle lire les lots code.

Conséquence à accepter d'avance : après le WAF, l'allongement des `cacheLife` ne rapporte plus $5.04 mais **$1.76**. Il ne reste plus grand-chose à réécrire. Ce n'est pas une perte, c'est le même gain compté une seule fois.

---

## 3. Phase 0, aujourd'hui, environ 45 minutes

Rien de destructif. Que de la lecture. Ces valeurs conditionnent la moitié des décisions qui suivent.

### 3.1 Sept valeurs à relever dans le dashboard Vercel

Détail en section 0 de `plan-action-infra.md`. En résumé : la règle custom existante et sa position, les numéros d'AS de chaque hébergeur cité, le CIDR réel derrière `94.20.158.61`, le digest JA4 dominant copié verbatim depuis l'écran, les catégories proposées par Bot Protection, la mémoire allouée par défaut aux fonctions, et les lignes d'abonnement facturées.

Aucun numéro d'AS ne doit venir d'une mémoire de modèle, y compris la mienne.

### 3.2 Le relevé de référence

Deux passages sur la page Usage, à H et H+24, en notant l'heure exacte. Les compteurs Vercel sont cumulés sur le cycle de facturation, pas des débits : seule la différence entre deux relevés est exploitable.

Références attendues, dérivées de la facture divisée par 62 jours : 26 290 invocations, 78 065 écritures ISR, 10 645 lectures ISR, 32 419 Edge Requests, 1.47 GB de transfert origine, 75 806 événements Observability.

### 3.3 La ligne de base humaine

C'est le point le plus important du dispositif. La table `page_view` n'est écrite que par `POST /api/track`, appelé côté client depuis `src/app/[owner]/[repo]/page.client.tsx:220` et `src/app/profile/[login]/page.client.tsx:329`, et cette route exige le cookie HMAC posé par le middleware. Une ligne dans `page_view` prouve donc qu'un navigateur a exécuté du JavaScript avec un cookie de session. Un bot sans moteur JS n'en produit jamais.

**N'utilise pas le `todayViews` du digest.** La requête filtre `WHERE date = ${today}` à minuit UTC (`src/app/api/admin/daily-digest/route.ts:40-44`) et le cron tourne à 06:00 UTC (`vercel.json`), donc le chiffre ne couvre que six heures. Vérifié sur quatre digests : 33 vues affichées pour 138 vues réelles sur la journée, soit 24 %, ce qui correspond au ratio 6h/24h.

Prends l'historique complet en une requête :

```sql
SELECT date::date AS jour,
       SUM(count) FILTER (WHERE type = 'repo')    AS repo,
       SUM(count) FILTER (WHERE type = 'profile') AS profile,
       SUM(count)                                  AS total
FROM page_view
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1 DESC;
```

**Baseline mesurée le 2026-08-16, sur 14 jours d'août** : médiane 128 vues/jour, moyenne 130 hors le pic isolé du 15/08 à 284. Écart-type journalier 32, soit ±25 %.

**Le seuil porte sur la moyenne 7 jours glissants, jamais sur une journée.** Un seuil de 25 % appliqué à un jour isolé vaut 1σ et se déclenche par hasard un jour sur six. Sur la moyenne 7 jours, σ tombe à 12 (±9 %) et le même seuil vaut 2,7σ. Référence à retenir : **130 ± 12 vues/jour en moyenne 7 jours**.

Deux points relevés dans l'historique, à traiter avant de figer la référence.

Le trafic est passé de 361 vues/jour (17 au 26 juillet) à 130 depuis le 1er août, soit une chute de 64 %. Cause probable : la campagne d'indexation du 22-23 juillet et la promotion associée, puis retour au niveau organique. La référence est donc 130, pas 361.

Les 27, 28 et 29 juillet n'ont **aucune ligne**, pas un chiffre bas. Trois hypothèses ont été testées et écartées le 2026-08-16 : la rotation de `SM_TOKEN_SECRET` (la variable a 138 jours et aucun `_PREV` n'existe), une purge par `/api/admin/cleanup` (la route ne supprime que `starEvent` et `gitHubUser`, jamais `page_view`), et un simple creux de trafic (un trou est complet, pas bas).

**Cause identifiée le 2026-08-16, et déjà corrigée.** Le commit `5f6e66f` (27/07 14:23) a retiré une trentaine de lignes de `src/app/api/track/route.ts` pour déplacer le rate limiting dans `src/proxy.ts`. Le limiteur déplacé partait fail-closed, donc toute instabilité Upstash renvoyait un 503 et supprimait toute écriture. Le commit `9643898` (29/07 20:51) a ajouté `src/lib/upstash-resilience.ts` et le flag `failClosed: false`, dont le commentaire à `src/proxy.ts:68` décrit exactement ce cas. Les données reprennent le 30/07.

Conséquence : la baseline d'août est post-correctif, donc fiable. Le trou ne peut pas se reproduire pour la même raison.

Biais résiduel connu et acceptable : `/api/track` reste plafonné à 60 requêtes par 60 secondes et par IP (`src/proxy.ts:70`). Derrière un CGNAT ou une IP d'entreprise partagée, des vues humaines sont perdues. L'oracle sous-compte donc légèrement, jamais l'inverse, et ce biais est constant dans le temps, donc sans effet sur une comparaison avant/après.

**Une explication alternative au recul de 64 % a été testée et écartée.** Le commit `9643898` portait aussi un durcissement CSP, susceptible de casser le beacon sur une partie des navigateurs et de produire un sous-comptage permanent. Une panne de collecte frappe uniformément, donc volume et diversité chuteraient dans les mêmes proportions. Le volume a reculé de 64 % et la diversité de 95 %, ce qui exclut cette piste. Le recul correspond à un vrai changement de trafic, cohérent avec la restriction GitHub qui a supprimé le cas d'usage « scanner n'importe quel repo » et laissé les repos populaires déjà en cache (`docs/superpowers/plans/2026-07-31-github-restriction-recovery.md`, commit `ff6fa1a`).

### 3.3.1 La diversité compte plus que le volume

`page_view` est clé par `(date, type, slug)`, donc le nombre de lignes donne le nombre de repos distincts vus dans la journée.

| Date | Vues repo | Repos distincts | Vues/repo |
|---|---|---|---|
| 24/07 | 177 | 103 | 1,7 |
| 25/07 | 157 | 117 | 1,3 |
| 26/07 | 359 | 299 | 1,2 |
| 27-29/07 | trou | trou | : |
| 30/07 | 93 | 25 | 3,7 |
| 31/07 | 103 | 16 | 6,4 |
| 01/08 | 78 | 13 | 6,0 |

Le volume a baissé de 64 %, la diversité de 95 %.

### 3.3.2 L'oracle est plus faible que prévu

La prémisse posée en 3.3 est qu'un bot sans moteur JavaScript n'écrit jamais dans `page_view`. Elle tient pour un scraper HTTP simple. Elle ne tient pas pour un Chrome headless piloté par Puppeteer ou Playwright, qui exécute le JavaScript et conserve ses cookies le temps d'une session. Le firewall montre 67 % de X11 Linux Chrome.

Un ratio de 1,2 vue par repo distinct sur 299 repos par jour est une signature de crawl, pas un profil de navigation humaine. Quelque chose d'automatisé écrivait donc dans la table en juillet.

**Surveille deux nombres, pas un.**

```sql
SELECT date::date AS jour, SUM(count) AS vues, COUNT(DISTINCT slug) AS repos_distincts,
       ROUND(SUM(count)::numeric / COUNT(DISTINCT slug), 1) AS ratio
FROM page_view WHERE type = 'repo' AND date >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1 DESC;
```

Lecture après une règle WAF : ratio au-dessus de 4 et volume proche de 130, les humains vont bien. Volume et ratio qui chutent ensemble, la règle a coupé des humains.

### 3.3.3 Trou de couverture

`page_view` ne couvre que les types `repo` et `profile`. Elle est aveugle sur `/`, `/explore`, `/devs/atlas`, `/feeds` et `/repos`, les cinq chemins les plus frappés au firewall. Pour ces pages, les seuls contrôles sont Google Search Console et les signalements utilisateurs.

### 3.3.4 La baseline de la facture est peut-être périmée

Les 78 065 écritures ISR par jour viennent de la facture du 1er juin au 2 août, qui **inclut** le crawl haute diversité de juillet. Si ce crawl s'est arrêté le 27 juillet, le débit actuel est déjà plus bas et une partie du problème s'est résolue seule.

**Conséquence : le relevé Usage de la section 3.2 conditionne tout le reste.** S'il montre un débit très inférieur à 78 065, l'économie WAF projetée à 10-12 $/mois est surestimée et les priorités changent. Fais-le avant de créer la moindre règle.

### 3.4 Six mesures qui débloquent les lots code

Détail en section 11 de `plan-action-code.md`. Deux sont bloquantes pour le lot 3 : lire `REPO_STATS_MV_ENABLED` via `vercel env ls`, puis chercher les logs `stats/totals timeout` sur 24 h pour chiffrer l'item 11, dont le gain va de $0 à $9.

Deux requêtes SQL calibrent les lots 5 et 13 :

```sql
SELECT owner, repo, length(points) FROM stargazer_cache ORDER BY 3 DESC LIMIT 10;
SELECT count(*) FROM badge_cache bc
WHERE EXISTS (SELECT 1 FROM stargazer_cache sc WHERE sc.owner = bc.owner AND sc.repo = bc.repo);
```

---

## 4. Phase 1, le WAF, J0 à J+7

Détail complet en section 1 de `plan-action-infra.md`.

Trois principes gouvernent l'ordre. Tout Allow avant tout Deny, sinon la première règle Deny coupe les badges README. Aucun Challenge ne touche jamais `/api/`. Rien ne passe en action terminale sans avoir séjourné 24 h en mode **Log**.

| Règle | J0 | J+1 | J+2 |
|---|---|---|---|
| 1. Allow `/api/badge/`, `/api/map-image/`, `/api/geo/`, UA `github-camo`, AS GitHub | Allow | Allow | Allow |
| 2. Allow verified bots + les 11 crawlers de `src/app/robots.ts:17-29` | Allow | Allow | Allow |
| 3. Deny `wp-`, `/.env`, `/.git`, `.php`, `/vendor/`, `/xmlrpc`, `/phpmyadmin`, `/.aws` | Deny | Deny | Deny |
| 4. Challenge JA4 dominant, hors `/api/` et `/_next/` | **Log** | **Challenge** | Challenge |
| 5. Deny ASN hébergement pur, hors `/api/mcp/` | **Log** | Log | **Deny partiel** |
| 6. Rate limit 60/min par IP, hors `/api/` et `/_next/` | absente | absente | **actif** |

La règle 1 cible les **chemins**, pas seulement le User Agent. GitHub peut changer la chaîne `github-camo` demain, il ne changera pas le fait que le badge tape `/api/badge/`.

La règle 4 reste en **Challenge**, jamais en Deny sec. JA4 trie ses champs avant hachage, donc le digest identifie une pile TLS et non un client : de vrais Chrome sur Linux le partagent. Un Deny les coupe, un Challenge les laisse passer en une seconde. N'ajoute aucune condition sur `Chrome/150.0.0.0`, c'est un UA parfaitement normal depuis la réduction d'UA de Chrome 101.

**Bot Protection reste éteint jusqu'à J+7.** C'est un toggle global sans granularité de chemin. Il s'appliquerait aux 9 familles de routes MCP, aux flux RSS, et aux 1 210 POST que la boucle de chunk émet pour un repo à 121k étoiles. Aucun de ces clients ne résout un challenge.

### Seuils de succès à J+2

| Métrique | Référence/jour | Cible | Échec |
|---|---|---|---|
| Firewall Allowed | 40 100 | 12 000 à 18 000 | > 30 000 |
| Function Invocations | 26 290 | 9 000 à 14 000 | baisse < 25 % |
| ISR Writes | 78 065 | 24 000 à 38 000 | baisse < 25 % |
| `page_view`, moyenne 7j glissants | 130 ± 12 | ±15 % | **chute > 25 %** |
| Résolution du challenge | néant | < 5 % | **> 30 %** |

Deux signaux imposent un rollback immédiat sans attendre la fin de la fenêtre. Une requête sur `/api/badge/` ou `/api/map-image/` qui apparaît en Denied ou Challenged, ce qui veut dire que des badges sont cassés en ce moment dans des README publics. Et une chute des Crawl Stats dans Google Search Console, qui met des semaines à se rattraper et ne se voit dans aucun compteur Vercel.

---

## 5. Phase 2, les lots code, à partir de J+3

Détail complet, diffs inclus, en sections 1 à 8 de `plan-action-code.md`.

| Lot | Scope de commit | $/mois après WAF | Bloqué par |
|---|---|---|---|
| 1 | `perf(api): borner la cardinalité du cache /api/repos` | prévention | rien |
| 2 | `perf(ui): unoptimized sur les 13 avatars next/image` | 1.56 | rien |
| 4 | `perf(ui): supprimer la duplication des 5000 repos sur /repos` | 0.41 | rien |
| 3 | `perf(cache): allonger les fenêtres cacheLife` | 1.76 | mesures 3.4 |
| 5 | `perf(api): gzip explicite sur stargazer-cache et repos` | non chiffré, probablement le plus gros | requête SQL |
| 6 | `refactor(api): extraire la logique des routes vers src/lib` | 1.10 à 1.45 | rien |
| 7 | `perf(config): exclure les assets statiques du matcher proxy` | 0.18 à 1.80 | mesure curl |
| 8 | `chore(config): retirer compress: false, cacher les OG images` | 0.00 | rien |

Les lots 1, 2 et 4 ne dépendent d'aucune mesure. Ils partent immédiatement, environ 45 minutes de travail pour $1.97/mois.

**Les items 10 et 11 partent dans le même commit, jamais séparément.** La sémantique du double `cacheLife` est un minimum par champ (`node_modules/next/dist/server/use-cache/cache-life.js:143-160`). Appliqué seul, l'item 11 donne `min(60, 60) = 60`, la branche `isPartial` devient identique à la branche normale, et on perd la protection décrite au commentaire de `src/app/[owner]/[repo]/page.tsx:48-53` sans gagner une seule écriture.

Le lot 5 traite le poste des 91 GB. Il doit poser un `Vary: Accept-Encoding` et éviter la double compression, piège identifié par plan-infra et intégré par plan-code.

Base de tests réelle : **1 222 tests, 109 fichiers, 8.06 s**. Le chiffre de 872 dans `.claude/rules/tdd-mandatory.md` est périmé, à corriger.

---

## 6. Ce qui est abandonné, et pourquoi

**Chiffrer l'item 9.** Preuve source en section 0.1 de `plan-action-code.md`. Faire le changement, ne pas le compter.

**L'item 16 tel que spécifié dans l'audit.** Renvoyer le blob gzip brut supprimerait l'arrondi à deux décimales de `stargazer-cache/[owner]/[repo]/route.ts:62-64`, qui est un contrôle de minimisation des données sur un blob écrit par le client sans validation. C'est un arbitrage RGPD déguisé en optimisation de transfert. La version réécrite en section 6.3 capture le même gain sans y toucher.

**L'item 15 sur `repo-info`.** Le handler consomme `x-gh-token`, donc l'extraction imposerait de changer la signature pour un appelant qui passera toujours `undefined`. Et le vrai coût du fichier n'est pas l'auto-appel, c'est le fetch contributeurs sans cache ligne 35, qui repart chez GitHub à chaque invocation. Faire la ligne de cache, pas l'extraction.

**Réduire `/repos` de 5 000 à 500 items.** $0.37/mois de plus contre la perte du tri sur l'intégralité du corpus, sur une page intitulée « All mapped repos ». Le volet A capture $0.41 pour une ligne et sans perte. Le volet B mérite sa propre PR avec un tri serveur.

**Toucher aux crons.** Ils pèsent $0.44/mois, soit 2 % de la facture. Un dégraissage agressif rapporterait $0.20. Les 15 minutes de WAF rapportent cinquante fois plus.

---

## 7. Les deux inconnues qui portent l'incertitude

**La part du trafic JA4 qui tape `/api/`.** La règle 4 exclut ces chemins pour protéger la boucle de chunk et les clients MCP. Cette part échappe donc au filtrage. Elle se mesure dans Firewall puis Traffic puis Top Paths, en additionnant à la main ce qui commence par `/api/`.

**Le comportement de facturation des Observability Events sur requêtes bloquées.** Vérifié pour les invocations de fonction, qui ne s'exécutent pas. Non vérifié pour les Edge Requests et les événements. Si à J+2 les invocations chutent de 60 % mais les événements de 20 % seulement, retire environ $2/mois de toutes les projections.

---

## 8. Maintenance

**Le digest JA4 va dériver.** Chrome publie une majeure toutes les quatre semaines et sa pile TLS évolue. Une règle qui cesse de matcher n'émet aucune alerte : le panneau affiche zéro correspondance, ce qui ressemble à un succès, et la facture remonte sur deux ou trois cycles avant que quelqu'un s'en aperçoive. Le premier de chaque mois, ouvre Firewall puis Traffic puis Top JA4 et compare. Cinq minutes.

**Les règles WAF ne sont pas dans git.** Elles vivent dans le dashboard, sans revue ni diff. Ce fichier est le registre : à chaque changement de règle, ajoute une ligne datée avec la valeur avant, la valeur après, et le chiffre qui a motivé la décision.

---

## Journal des changements de règles

| Date | Règle | Avant | Après | Chiffre déclencheur |
|---|---|---|---|---|
| | | | | |
