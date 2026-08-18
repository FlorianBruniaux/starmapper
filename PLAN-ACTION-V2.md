# Plan d'action v2 : coûts Vercel et durcissement firewall

**Date** : 2026-08-17
**Méthode** : mesures live via `vercel metrics` et `vercel firewall` sur le projet `starmapper` (scope `florianbriauxs-projects`), fenêtre 7 jours au 16/08 17:38 UTC, plus 3 captures du dashboard Firewall en fenêtre 24 h.
**Statut de l'audit précédent** : `research-vercel-cost-audit.md` et `plan-action-infra.md` sont partiellement périmés. Les corrections sont en §1.

---

## 1. Ce que les mesures fraîches invalident

L'audit du 15 août travaillait sur une période de facturation de deux mois qui incluait le crawl arrêté le 27 juillet. J'avais signalé le risque de surestimation. Il est confirmé, et deux conclusions de fond tombent.

| Grandeur | Audit du 15/08 | Mesure du 16/08 | Écart |
|---|---|---|---|
| Écritures ISR / jour | 78 065 | **44 819** | −43 % |
| Lectures ISR / jour | 10 645 | 6 486 | −39 % |
| Ratio écriture/lecture | 7,3:1 | 6,9:1 | stable |
| Invocations de fonctions / jour | non mesuré | 4 966 | : |
| Coût ISR Writes / mois | 9,68 $ équivalent | **5,45 $** | −44 % |

Le ratio n'a pas bougé, ce qui veut dire que le cache continue de fonctionner comme un journal d'écriture. Le volume, lui, a été divisé par deux avec le départ du crawler. Le poste reste le premier de la facture.

**La deuxième correction est plus sévère.** L'audit désignait les routes repo dynamiques comme responsables des écritures. Elles sont à zéro.

```
134 863  /trending
 49 329  /trending.segments/_full.segment
 49 204  /trending.segments/trending/__PAGE__.segment
 22 230  /repos
  9 352  /repos.segments/_full.segment
  9 352  /repos.segments/repos/__PAGE__.segment
  2 697  /index
    789  /devs
    741  /devs/atlas
      0  /[owner]/[repo]
      0  /[owner]/[repo]/contributors
      0  /[owner]/[repo]/dependents
```

La famille `/trending` pèse **233 396 écritures sur 313 734, soit 74,4 %**. Avec `/repos` à 13,0 %, deux pages de liste concentrent **87 % du poste de coût numéro un**. Tout le travail fait sur les routes `[owner]/[repo]` dans la PR #125 ne touchait pas la vraie cause.

## 2. La cause racine : une entrée de cache de 14,7 Mo réécrite toutes les 5 minutes

`src/lib/trending-query.ts:79` définit `fetchTrendingMap()`, qui construit un tableau de points de carte et le met en cache :

```ts
cacheLife({ revalidate: 300, stale: 3600 });
...
return mapPoints.slice(0, MAX_MAP_POINTS);   // MAX_MAP_POINTS = 30_000  (ligne 33)
```

Le commentaire de la ligne 32 donne la taille sans que j'aie à l'estimer : « 30k points × ~490 bytes ≈ 14.7 MB ». Next.js découpe une entrée de cette taille en unités d'écriture d'environ 220 Ko, soit à peu près 67 unités. Avec `revalidate: 300`, la fenêtre expire 288 fois par jour.

L'arithmétique se referme sur la mesure : 67 × 288 = 19 296 unités attendues par jour, et le compteur en relève **19 266**. Le tout pour **3 invocations de fonction** sur la même journée (dashboard Observability, onglet Functions, 24 h). Le coût ne vient pas du trafic, il vient de la taille de l'entrée multipliée par la fréquence de réécriture.

Le cron `/api/admin/refresh-trending` tourne toutes les 6 heures et appelle `revalidateTag("trending", "hours")` à la ligne 103. Les données sous-jacentes changent donc 4 fois par jour. La fenêtre de 5 minutes est 72 fois trop courte pour ce que le contenu exige.

**Deux leviers indépendants, tous les deux à un chiffre près :**

| Changement | Fichier | Facteur | Statut |
|---|---|---|---|
| `revalidate: 300` → `21600` | `trending-query.ts`, les deux fonctions | ÷ 72 sur la fréquence | **appliqué**, commit `7ad81a1` |
| `revalidate: 300` → `21600` | `repos-query.ts:45` | ÷ 72 sur la fréquence | **appliqué**, commit `7ad81a1` |

Aucun des deux ne coûte de fraîcheur, et c'est le point qui les rend sûrs. `revalidateTag("trending")` est appelé par le cron toutes les 6 heures, `revalidateTag("repos")` l'est par `badge-update/route.ts:113` et `contributors-badge-update/route.ts:43` à la fin de chaque scan. La fenêtre ne gouverne que la durée de vie d'une entrée que personne n'a invalidée.

Calcul de l'économie, en supposant que seules les invalidations par tag subsistent :

| Famille | Avant / jour | Après / jour |
|---|---|---|
| `/trending` | 33 342 | ≈ 800 |
| `/repos` | 5 848 | ≈ 500 |
| reste | 5 629 | 5 629 |
| **total** | **44 819** | **≈ 6 900** |

Le poste ISR Writes passe de **5,45 $ à environ 0,84 $ par mois**, soit **4,61 $ d'économie**. Il cesse d'être le premier poste de la facture.

### Pourquoi je retire la piste `MAX_MAP_POINTS`

Le plan initial proposait de descendre le cap de 30 000 à 5 000 points. Deux mesures faites après coup me font retirer cette recommandation.

Le cap mord réellement : les cinq dépôts du top trending totalisent **108 207 points cartographiés**, dont 98 556 pour `practical-tutorials/project-based-learning` à lui seul. Les 14,7 Mo sont donc une taille réelle et non une borne théorique. Jusque-là l'argument tenait.

Mais `StargazerPoint` porte onze champs, et `stargazer-map.tsx:187-193` les lit **tous** pour construire les popups : `name`, `bio`, `company`, `location`, `followers`, `avatarUrl`, `linkedinUrl`. Couper le nombre de points dégrade les compteurs de clusters affichés à l'utilisateur, alléger chaque point vide les popups. Les deux sont des régressions produit, pas des optimisations.

Et surtout, après le correctif de fenêtre, la famille `/trending` coûte de l'ordre de **0,10 $ par mois**. Diviser sa taille par six en ferait gagner huit centimes contre une dégradation visible. Le rapport ne se défend plus.

La seule micro-optimisation qui resterait gratuite est de ne pas stocker `avatarUrl`, que `trending-query.ts` reconstruit lui-même depuis `login` avant de le mettre en cache, et que le client pourrait reconstruire à l'identique. Cela vaut environ 1,2 Mo sur 14,7, soit 8 %, soit moins d'un centime par mois désormais. À laisser.

## 2 bis. Ce que devient la facture, et pourquoi cela change la stratégie

Une fois le correctif de fenêtre appliqué, plus aucun poste ne domine. Voici l'ensemble des lignes mesurables, ramenées au mois, fenêtre 7 jours au 18/08 :

| Poste | Mesure 7 jours | Par mois | Coût |
|---|---|---|---|
| Fast Origin Transfer | 4,96 Go | 21,3 Go | **1,45 $** |
| Image Optimization | 3 686 transformations | 16 000 | **0,96 $** |
| ISR Writes après correctif | : | 0,21 M | **0,84 $** |
| Fluid Active CPU | 3 818 s | 4,6 h | **0,67 $** |
| Observability Events (estimation) | : | ≈ 1,05 M | ≈ 1,26 $ |
| ISR Reads | 45 401 | 0,20 M | 0,08 $ |
| Function Invocations | 34 763 | 0,15 M | 0,07 $ |

Six lignes entre 0,07 $ et 1,45 $. Chercher la prochaine optimisation applicative reviendrait à gratter des dizaines de centimes, poste par poste, sur du code qui marche.

**C'est exactement ce qui donne sa valeur au firewall.** Une requête bloquée n'entre dans aucune de ces lignes : ni CDN Request, ni Fast Data Transfer, ni invocation de fonction, ni invocation de middleware, ni écriture ISR, ni événement d'observabilité. Elle disparaît en amont de la facturation, pas à l'intérieur.

Avec 60 % du trafic venant de sept hébergeurs, le filtre attaque les sept lignes en une seule fois, pour un coût de mise en œuvre nul. L'ordre de grandeur est de **2,50 $ par mois**, davantage que toute optimisation de code restante, et sans toucher au produit.

Un chiffre secondaire mérite d'être noté au passage : le middleware tourne **18 125 fois par jour** contre 4 966 invocations de fonction, soit sur 52 % des requêtes. Le resserrement du matcher dans la PR #125 (commit `a01c6c4`) vise précisément cette ligne, et son effet sera lisible sur `vercel.middleware_invocation.count` après merge.

## 3. État réel du firewall

Configuration live lue le 16/08 :

| Élément | Valeur | Lecture |
|---|---|---|
| Firewall | Enabled | : |
| Custom rules | 1 active | `geo AS number equals 45102` → Deny |
| IP Blocking | 0 | levier gratuit inutilisé |
| System Bypass | 0 IP | : |
| Bot Protection (managed) | **Log** | détecte, n'applique rien |
| AI Bots (managed) | Allow | volontaire, voir §6 |
| BotID | non installé | le niveau Basic est gratuit |
| Attack Mode | Off | correct hors incident |
| System Mitigations | Active | : |
| Rate limiting | aucune règle | : |

**La règle Alibaba ne sert plus.** Elle a bloqué 185 requêtes en 7 jours, soit 26 par jour, contre les 71 000/heure que son nom revendique. Le scraper a changé d'hébergeur. C'est le défaut structurel du blocage par ASN : il traite l'adresse du moment, pas le comportement.

Voici où il est parti, en 24 h :

| AS Name | Requêtes | Nature |
|---|---|---|
| Datacamp Limited | 6 068 | hébergeur, sortie VPN |
| EGIHosting | 5 974 | datacenter |
| M247 Europe SRL | 2 809 | hébergeur, sortie VPN |
| FDCservers.net | 2 408 | datacenter |
| GitHub, Inc. | 2 280 | **légitime, voir §4** |
| Web2Objects LLC | 1 901 | datacenter |
| Amazon.com | 1 663 | mixte |
| WISH NET PRIVATE LIMITED | 1 201 | FAI indien |
| Vodafone GmbH | 1 105 | FAI allemand |
| trafficforce, UAB | 1 043 | datacenter |
| HostPapa | 870 | hébergement mutualisé |

Sept hébergeurs totalisent 21 073 requêtes sur environ 34 900, soit **60 % du trafic**. Les deux lignes FAI sont trompeuses : WISH NET correspond à l'IP unique `103.219.45.144` qui fait 1 200 requêtes par jour, et Vodafone à `92.209.156.93` qui en fait 1 100. Une IP résidentielle qui émet 1 200 requêtes quotidiennes sur un site de cartographie de stargazers n'est pas un foyer, c'est un nœud de sortie de proxy résidentiel.

La signature TLS confirme la concentration. Le digest JA4 `t13d1516h2_8daaf6152771_806a8c22fdea` porte **28 900 requêtes sur 34 900, soit 83 %**, et l'agent `Mozilla/5.0 (X11; Linux x86_64)` en porte 25 300, soit 72 %.

Le classement par nom de bot achève le tableau : 35 752 requêtes sur 24 h ne portent **aucun nom de bot connu**. Les crawlers identifiés se répartissent entre github-camo (2 408), bingbot (281), amazonbot (165), semrush (126), oai-searchbot (117), googlebot (95), petalbot (82), googleother (58) et claudebot (26).

## 4. Ce qu'il ne faut jamais bloquer

GitHub camo ne touche qu'une seule famille de chemins, et c'est la vitrine du produit :

```
/api/map-image/diegosouzapw/omniroute            878
/api/map-image/rtk-ai/rtk                        584
/api/map-image/itsfatduck/optimizerDuck          250
/api/map-image/wuyoscar/GPT-Image2-Skill         197
/api/map-image/FlorianBruniaux/claude-code-...   144
```

Ce sont les cartes embarquées dans les README de huit dépôts. Camo est un proxy image : il n'exécute pas de JavaScript, donc **un challenge le tue aussi sûrement qu'un deny**. Toute règle qui pourrait l'atteindre doit être précédée d'un bypass explicite.

Même raisonnement pour `/api/mcp/*`, dont les clients sont par construction non-navigateurs.

## 5. Le fait économique qui commande la stratégie

La documentation Vercel est sans ambiguïté (`/docs/vercel-firewall/vercel-waf/usage-and-pricing`) :

> WAF deny, challenge, or rate-limit mitigated traffic does not incur CDN Requests or Fast Data Transfer (FDT). Requests that pass a challenge and continue to your application count toward normal usage.

Les règles custom, le blocage IP et la mitigation DDoS sont **gratuits sur tous les plans**. Seuls le rate limiting et les managed rulesets de type OWASP sont facturés à l'usage.

Conséquence directe : chaque requête bloquée disparaît entièrement de la facture, pas seulement de la charge serveur. Les 21 073 requêtes datacenter quotidiennes représentent 60 % des Edge Requests et de la Fast Data Transfer associée, et bloquer coûte zéro.

Un second mécanisme mérite d'être activé, les **persistent actions** :

> It happens before the firewall processes the request, so that none of the requests blocked by persistent actions count towards your CDN and traffic usage.

Sans persistent action, chaque requête d'un client déjà identifié est réévaluée. Avec, l'IP est mise sur banc de touche pour la durée choisie et ses requêtes suivantes ne traversent même plus le firewall. La règle Alibaba actuelle n'en a pas.

## 6. Plan firewall, dans l'ordre d'exécution

Les règles s'évaluent de haut en bas et la première qui deny ou challenge arrête la chaîne. L'ordre ci-dessous n'est pas indicatif, il est la sécurité du dispositif.

**Règle 1, Bypass, à créer en premier.**
Condition : `Request Path` starts with `/api/map-image` OR starts with `/api/badge`.
Action : Bypass.
Elle met les README embarqués hors d'atteinte de tout ce qui suit, y compris du managed ruleset. Sans elle, l'étape 4 casse la vitrine du produit.

**Règle 2, Bypass.**
Condition : `Request Path` starts with `/api/mcp`.
Action : Bypass.

**Règle 3, Deny avec persistent action.**
Condition : `AS Number` is one of Datacamp Limited, EGIHosting, FDCservers.net, Web2Objects LLC, trafficforce UAB, HostPapa.
Action : Deny, persistent 1 heure.
J'ai volontairement **sorti M247 Europe SRL de cette liste** : c'est l'hébergeur d'un grand nombre de VPN grand public, et un utilisateur réel sous NordVPN ou Surfshark peut en sortir. Les six autres n'hébergent pas de clients finaux.
Numéros d'AS à relever dans le dashboard au moment de créer la règle, le builder les résout depuis le nom.

**Règle 4, le changement à plus fort levier : Bot Protection de Log à Challenge.**
Le managed ruleset détecte les clients qui violent le comportement navigateur et exclut automatiquement les bots vérifiés, Googlebot inclus. La documentation cible explicitement le cas présent : « It prevents requests that falsely claim to be from a browser such as a curl request identifying as Chrome. » C'est la description exacte des 25 300 requêtes en `X11; Linux x86_64`.

Réserve honnête : le scraper charge les chunks `_next/static`, donc il exécute du JavaScript. Un Chrome headless peut résoudre un challenge JS. Le ruleset ne se limite pas à cette vérification, mais je ne peux pas garantir le taux de capture avant de l'avoir mesuré. C'est pour cette raison que l'étape 3 le précède plutôt que de s'y substituer.

**Règle 5, blocage IP, section IP Blocking et non custom rule.**
`103.219.45.144` et `92.209.156.93`.
Les deux font plus de 1 100 requêtes par jour depuis une IP unique. Le blocage IP est gratuit et les requêtes bloquées ne comptent pas dans la facture.

**Règle 6, à évaluer seulement après mesure des cinq premières.**
Rate limit sur les routes de page, clé JA4 Digest, fenêtre 60 s, limite 100. Le rate limiting est une **fonctionnalité facturée à l'usage** sur Pro, et les compteurs sont tenus par région, donc la limite réelle est un multiple du réglage. À ne poser que si les règles 1 à 5 laissent passer un résidu significatif.

### Ce que je déconseille explicitement

**Ne touche pas au ruleset AI Bots.** Il est sur Allow, et `src/app/robots.ts:17-29` invite délibérément GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot et Google-Extended pour la visibilité GEO. Le passer en Deny contredirait une décision produit assumée, pour 26 à 117 requêtes quotidiennes par crawler.

**N'active pas BotID Deep Analysis.** Le niveau Basic est gratuit et vaut la peine sur `/api/chunk` et `/api/stargazer-cache`, via `npm i botid` puis un appel à `checkBotId()`. Deep Analysis coûte 1 $ par tranche de 1 000 appels : sur les seules 209 requêtes quotidiennes de `/api/stargazer-cache`, la facture serait de 6,30 $ par mois, soit davantage que le poste ISR après correctif.

**N'active pas Attack Mode** hors incident réel. Il challenge tout le monde.

**Ne bloque pas semrush et petalbot par user agent.** Cela représente 208 requêtes par jour et l'écriture d'une règle qui devra être maintenue.

## 7. Versionner la configuration firewall

`vercel.json` accepte des règles WAF via `routes` et la propriété `mitigate`, limitées aux actions `deny` et `challenge` (les actions `log`, `bypass` et `redirect` restent réservées au dashboard) :

```json
{
  "routes": [
    {
      "src": "/(.*)",
      "has": [{ "type": "header", "key": "x-exemple" }],
      "mitigate": { "action": "deny" }
    }
  ]
}
```

Les bypass des règles 1 et 2 ne sont donc pas exprimables en fichier. La configuration restera mixte, et c'est une raison de plus pour documenter l'ordre des règles ici plutôt que de compter sur le dashboard comme source de vérité.

## 8. Séquencement

La contrainte d'attribution du plan précédent tient toujours, et elle se resserre : le correctif `/trending` et les règles firewall touchent tous les deux aux Edge Requests. Mais ils ne touchent pas au même poste dominant, ce qui autorise un séquencement plus court qu'annoncé.

| Jour | Action | Poste visé | Mesure de contrôle |
|---|---|---|---|
| J0 | Relever `isr_operation.write_units` et `function_invocation.count` sur 24 h | référence | : |
| J0 | Règles 1 et 2 (bypass) seules | aucun | vérifier qu'une carte README se charge encore |
| J1 | Règles 3 et 5 (deny ASN + IP) | Edge Requests, FDT | `firewall_action.count` par `waf_action` |
| J2 | Règle 4 (Bot Protection en Challenge) | Edge Requests | surveiller `challenge-solved` : un ratio élevé signale des humains challengés |
| J4 | Correctif `/trending` en PR séparée | ISR Writes | `write_units --group-by route` |

Commandes de mesure, à relancer à heure fixe :

```bash
vercel metrics vercel.isr_operation.write_units --since 1d --prod --group-by route --order-by value
vercel metrics vercel.firewall_action.count --since 1d --group-by waf_action
vercel metrics vercel.firewall_action.count --since 1d --group-by asn_name --order-by value
```

Déclencheur de rollback sur la règle 4 : si `challenge` dépasse 500 par jour alors que `challenge-solved` reste sous 10 %, des clients légitimes sont pris. Repasser en Log et rouvrir l'analyse.

## 9. Ce que je n'ai pas pu établir

`vercel.isr_operation.write_bytes` renvoie une moyenne par intervalle et non un total, ce qui rend le rapport octets/unité incohérent avec le compte d'unités. J'ai donc raisonné uniquement sur `write_units`, qui est la grandeur facturée à 4,00 $ le million.

La taille de 14,7 Mo de l'entrée `fetchTrendingMap` vient du commentaire de `trending-query.ts:32`, et le fait que le cap de 30 000 morde réellement est confirmé par requête sur la base de production (108 207 points cartographiés sur les cinq dépôts du top). Le découpage en unités d'environ 220 Ko, lui, est déduit du quotient 19 266 / 288 et non d'une documentation Next.js. Le correctif ne dépend pas de cette déduction : la fenêtre de revalidation est trop courte quel que soit le mode de découpage.

La ligne Observability Events du tableau §2 bis est la seule estimation du document. Aucune métrique de la CLI ne l'expose, je l'ai déduite du volume de requêtes multiplié par le tarif de 1,20 $ le million. À vérifier sur la facture.

Le taux de capture réel du managed ruleset Bot Protection face à un Chrome headless reste inconnu tant que la règle 4 n'a pas tourné 24 h.

Le prix exact du rate limiting sur Pro n'est pas publié dans la documentation consultée, la section « Rate limiting pricing » y est vide. À demander avant d'activer la règle 6.
