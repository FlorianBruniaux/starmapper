# Plan d'action infra : WAF, mesure, rollback, crons

**Date** : 2026-08-16
**Périmètre** : dashboard Vercel uniquement. Aucun patch applicatif ici, un autre agent traite `next.config.ts`, `src/app/[owner]/[repo]/page.tsx`, les `next/image` et les auto-appels HTTP.
**Source des chiffres** : `research-vercel-cost-audit.md` pour la facture et le trafic, lecture directe du repo pour tout ce qui concerne les crons, le middleware et le tracking.
**Base de calcul** : $21.82/mois d'infra, 40.1k requêtes autorisées/24h, 26 290 invocations/jour, 78 065 écritures ISR/jour.

---

## 0. Inventaire préalable, à faire avant de créer la moindre règle

Sept valeurs ne peuvent pas être devinées depuis le repo. Elles se relèvent dans le dashboard, en une session de dix minutes, et elles conditionnent la moitié des règles ci-dessous. Note-les dans un fichier avant de toucher à quoi que ce soit.

| # | Quoi relever | Où exactement | Pourquoi |
|---|---|---|---|
| 1 | La règle custom déjà présente : son nom, sa condition, son action, sa position | Projet → onglet **Firewall** → **Custom Rules** | Elle occupe une place dans l'ordre d'évaluation. Si c'est un Deny, elle peut préempter les Allow qu'on va créer. |
| 2 | Le numéro d'AS de chaque hébergeur cité | Firewall → **Traffic** → panneau **Top AS Names**, le numéro s'affiche à côté du nom | Aucun numéro d'AS ne doit venir d'une mémoire de modèle, y compris la mienne. |
| 3 | Le préfixe CIDR réel derrière `94.20.158.61` et `94.20.159.16` | Firewall → Traffic → **Top IPs**, puis clic sur l'IP | Le rapport propose `94.20.156.0/22`, c'est une déduction, pas une observation. |
| 4 | Le digest JA4 dominant, copié verbatim | Firewall → Traffic → **Top JA4 Digests** | Le rapport donne `t13d1516h2_8daaf6152771_806a8c22fdea`. Recopie depuis l'écran, pas depuis ce document. |
| 5 | La liste exacte des catégories proposées par Bot Protection | Firewall → **Bot Protection** → détail des catégories avant activation | Il faut savoir si les crawlers IA sont une catégorie séparée et quelle est son action par défaut. |
| 6 | La mémoire allouée par défaut aux fonctions | Project Settings → **Functions** | Détermine si le levier de la section 4.5 existe. |
| 7 | Les lignes d'abonnement facturées | Team Settings → **Billing** → détail de la souscription | Confirme ou infirme la présence de l'add-on Observability Plus. |

---

## 1. Séquencement des règles WAF

### 1.1 Trois principes qui gouvernent l'ordre

Le premier : **tout Allow avant tout Deny**. Les règles Vercel s'évaluent de haut en bas, la première action terminale gagne. Un Deny placé avant l'Allow des badges coupe les badges, point final.

Le deuxième : **aucun Challenge ne doit jamais toucher `/api/`**. Un challenge managé exige un moteur JavaScript et des cookies. Les consommateurs de `/api/` chez StarMapper sont le proxy camo de GitHub (`/api/badge/`, `/api/map-image/`), les clients MCP sur les neuf familles de routes de `src/app/api/mcp/`, les flux `/api/feed/[login]/rss` et `/json`, et la boucle de chunk du navigateur qui poste jusqu'à 1210 fois sur `/api/chunk` pour un repo à 121k étoiles. Aucun de ces clients ne résout un challenge, et pour la boucle de chunk le challenge tomberait au milieu d'un scan déjà entamé. La condition `Path does not start with /api/` est donc portée par toutes les règles Challenge et par la règle de rate limit, pas par une règle Allow globale : on garde ainsi la possibilité de poser des Deny secs sur `/api/` pour les scanners.

Le troisième : **rien ne passe en action terminale sans être passé par Log**. Le WAF Vercel propose une action **Log** qui compte les correspondances sans rien bloquer. C'est le mode staging. Chaque règle risquée y séjourne 24 heures, on lit l'échantillon de correspondances dans le journal d'événements, puis on bascule l'action.

### 1.2 L'ordre de création, étape par étape

L'ordre de **création** est l'ordre de **priorité**. Ne crée pas la règle 4 avant la 1.

---

**RÈGLE 1 : Allow des embarquables publics**

| Champ | Valeur |
|---|---|
| Nom | `allow-public-embeds` |
| Condition | `Request Path` **starts with** `/api/badge/` **OR** `Request Path` **starts with** `/api/map-image/` **OR** `Request Path` **starts with** `/api/geo/` **OR** `User Agent` **contains** `github-camo` **OR** `AS Name` **equals** la valeur relevée à l'inventaire #2 pour GitHub |
| Action | **Allow** |
| Priorité | 1 |
| Staging | Aucun. Une règle Allow ne peut rien casser, elle se pose directement en actif. |

Deux justifications de code pour les chemins. `src/proxy.ts:224-228` classe ces trois préfixes en tier `public`, c'est-à-dire sans vérification de referer ni de cookie, précisément parce qu'ils sont embarqués dans des README tiers. `src/proxy.ts:382-388` leur sert un `Access-Control-Allow-Origin: *`. Le chemin est un critère plus stable que le User Agent : GitHub peut changer la chaîne `github-camo` du jour au lendemain, il ne changera pas le fait que le badge tape `/api/badge/`.

Volume protégé : 2.5k requêtes/24h sur l'AS GitHub. Gain : nul, c'est une assurance.

---

**RÈGLE 2 : Allow des crawlers, moteurs de recherche et IA**

| Champ | Valeur |
|---|---|
| Nom | `allow-verified-crawlers` |
| Condition A | catégorie **Verified Bots** de Vercel |
| Condition B | `User Agent` **contains** l'un de : `GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `PerplexityBot`, `ClaudeBot`, `anthropic-ai`, `cohere-ai`, `Google-Extended`, `Bingbot`, `msnbot`, `Googlebot` |
| Action | **Allow** |
| Priorité | 2 |
| Staging | Aucun. |

Cette liste n'est pas arbitraire, c'est la copie exacte de `src/app/robots.ts:17-29`. Le fichier robots.txt invite ces onze agents à indexer le site. Un WAF qui les bloque met l'application en contradiction avec sa propre politique d'indexation, et la perte est invisible pendant des semaines.

Attention au recouvrement avec la règle 5 : un faux GPTBot sortant d'un ASN d'hébergement sera autorisé par cette règle puisqu'elle est prioritaire. C'est le prix de la protection SEO. Si le journal montre un volume anormal sur ces UA, la parade est d'ajouter `AND AS Number in (liste hébergeurs)` en négatif, pas de supprimer la règle.

---

**RÈGLE 3 : Deny des motifs de scan de vulnérabilité**

| Champ | Valeur |
|---|---|
| Nom | `deny-vuln-scanners` |
| Condition | `Request Path` **contains** l'un de : `wp-`, `/.env`, `/.git`, `.php`, `/vendor/`, `/xmlrpc`, `/phpmyadmin`, `/.aws`, `/config.json` |
| Action | **Deny** |
| Priorité | 3 |
| Staging | Aucun, mais vérifie d'abord d'un coup d'œil que `STATIC_ROUTE_SEGMENTS` (`src/proxy.ts:124-135`) ne contient aucune de ces chaînes. Elle n'en contient aucune. |

Pourquoi c'est du coût pur aujourd'hui : `src/app/[owner]/page.tsx:23` accepte n'importe quelle chaîne d'un segment sans validation, donc `/wp-admin` déclenche un rendu serveur complet plus une écriture ISR pour une clé qui ne sera jamais relue. Le middleware s'exécute lui aussi, puisque son matcher (`src/proxy.ts:535-540`) n'exclut que `_next/static`, `_next/image` et `favicon.ico`.

Gain : $0.30 à $0.80/mois. Faux positif : aucun.

---

**RÈGLE 4 : Challenge sur l'empreinte JA4 dominante, pages seulement**

| Champ | Valeur |
|---|---|
| Nom | `challenge-ja4-pages` |
| Condition | `JA4 Digest` **equals** la valeur relevée à l'inventaire #4 **AND** `Request Path` **does not start with** `/api/` **AND** `Request Path` **does not start with** `/_next/` |
| Action jour 0 | **Log** |
| Action jour 1 | **Challenge** |
| Priorité | 4 |
| Volume ciblé | 30.2k requêtes/24h moins la part qui tape `/api/` |
| Gain | **$6.00 à $9.00/mois** |

Le rapport chiffre $9.00 à $10.50 sur le JA4 sans restriction de chemin. J'abaisse la fourchette parce que la condition `does not start with /api/` retire une part inconnue du volume. Cette part se mesure : Firewall → Traffic → Top Paths, additionne ce qui commence par `/api/`. Le gain réel se lira de toute façon au compteur 48h après.

N'ajoute aucune condition sur `Chrome/150.0.0.0`. La correction est déjà dans le rapport en section 5.1 : depuis la réduction d'UA de Chrome 101, la queue `.0.0.0` est le format normal, et la 150 en août 2026 est simplement une version en léger retard sur la stable. Une condition sur cette chaîne ne filtre rien de plus et donne une fausse impression de précision.

Le Challenge est le régime cible, pas une étape transitoire. JA4 trie ses champs avant hachage, donc le digest identifie une pile TLS et non un client : de vrais Chrome sur Linux le partagent. Un Deny sec les coupe, un Challenge les laisse passer en une seconde sans qu'ils s'en aperçoivent.

---

**RÈGLE 5 : Deny des ASN d'hébergement pur, hors MCP**

| Champ | Valeur |
|---|---|
| Nom | `deny-hosting-asn` |
| Condition | `AS Number` **is in** la liste relevée à l'inventaire #2 **AND** `Request Path` **does not start with** `/api/mcp/` |
| Action jour 0 | **Log** |
| Action jour 2 | **Deny**, et seulement pour les AS dont le journal montre zéro trafic plausiblement humain |
| Priorité | 5 |
| Gain | **$1.50 à $3.00/mois**, largement recouvert par la règle 4 |

Cibles par volume décroissant, à convertir en numéros d'AS depuis le dashboard : Datacamp Limited 5.3k, EGIHosting 4.1k, M247 Europe SRL 2.2k, FDCservers.net 2.0k, Web2Objects LLC 1.9k, trafficforce UAB 1.3k.

À ne pas mettre dans la liste : Amazon.com 2.0k et Google Cloud. Les crons Vercel, les clients MCP hébergés et les intégrations légitimes sortent par là. Comcast 1.5k, RCN 791 et British Telecom 740 sont résidentiels.

L'exclusion `/api/mcp/` protège les clients MCP qui tournent en cloud plutôt que sur un poste. Un Claude Desktop sur un portable sort par un ASN résidentiel, un client MCP hébergé sort par AWS ou GCP, et rien ne garantit qu'un futur intégrateur ne sortira pas par M247.

Cas Delta Telecom Ltd, 2.5k : c'est le transit national azerbaïdjanais. Deux IP du même bloc en tête du classement avec un profil de pic unique, c'est un scan. Bloquer l'AS entier géo-bloque un pays. Fais une règle séparée, `deny-cidr-scan`, condition `IP Address` **in CIDR** avec le préfixe relevé à l'inventaire #3, action Deny, priorité 6.

---

**RÈGLE 6 : Rate limit par IP sur les pages**

| Champ | Valeur |
|---|---|
| Nom | `ratelimit-pages` |
| Condition | `Request Path` **does not start with** `/api/` **AND** `Request Path` **does not start with** `/_next/` |
| Action | **Rate Limit**, 60 requêtes / 60 s, clé = IP, dépassement = Deny |
| Priorité | 7 |
| Action jour 0 | **Log** si l'UI le permet sur une règle de rate limit, sinon création directe au jour 2 |
| Gain | **$1.00 à $2.00/mois** |

Le compteur firewall affiche **Rate Limited: 0**, donc rien n'est armé côté Vercel aujourd'hui. Le seul rate limiting existant vit dans `src/proxy.ts`, et il ne s'applique **qu'à `/api/`** : la branche `src/proxy.ts:408-429` traite les requêtes de page et retourne avant toute vérification de débit. Une page n'est donc limitée nulle part actuellement.

La condition d'exclusion de `/api/` n'est pas cosmétique, c'est ce qui empêche la règle de tuer les gros scans. Un repo à 121k étoiles produit 1210 POST sur `/api/chunk` depuis une seule IP. Le limiteur applicatif les plafonne déjà à 30 par minute (`src/proxy.ts:56`), soit 40 minutes de scan minimum. Une règle WAF à 60/min appliquée à tous les chemins couperait ce scan à mi-parcours, et l'utilisateur verrait une erreur qu'aucun log applicatif n'expliquerait.

Le seuil de 60/min est confortable pour un humain, qui navigue à 10 ou 20 pages par minute. Ne le descends pas sous 40 : les opérateurs mobiles font sortir des milliers d'abonnés derrière une poignée d'IP en CGNAT.

---

**RÈGLE 7 : Deny composite, seulement si la 4 ne suffit pas**

| Champ | Valeur |
|---|---|
| Nom | `deny-ja4-datacenter` |
| Condition | `JA4 Digest` **equals** inventaire #4 **AND** `AS Number` **is in** la liste de la règle 5 **AND** `Request Path` **does not start with** `/api/` |
| Action | **Deny** |
| Priorité | 4bis, juste avant la règle 4 |
| Quand | J+7, et uniquement si le taux de résolution du challenge de la règle 4 est inférieur à 5 % |

Un Deny sec n'est acceptable qu'avec la double condition. Un utilisateur résidentiel n'est jamais dans ces AS, donc le faux positif redevient négligeable. Le gain sur la règle 4 est marginal, quelques dixièmes de dollar : un challenge non résolu coûte déjà presque rien. L'intérêt réel est de supprimer l'Edge Request du challenge lui-même.

### 1.3 Ce qui est actif à quel moment

| Règle | J0 | J+1 | J+2 | J+7 |
|---|---|---|---|---|
| 1. allow-public-embeds | Allow | Allow | Allow | Allow |
| 2. allow-verified-crawlers | Allow | Allow | Allow | Allow |
| 3. deny-vuln-scanners | Deny | Deny | Deny | Deny |
| 4. challenge-ja4-pages | **Log** | **Challenge** | Challenge | Challenge |
| 5. deny-hosting-asn | **Log** | Log | **Deny** partiel | Deny |
| 6. ratelimit-pages | absente | absente | **Rate Limit** | Rate Limit |
| 7. deny-ja4-datacenter | absente | absente | absente | à décider |

---

## 2. Protocole de mesure

### 2.1 Le piège des compteurs cumulés

La page Usage de Vercel affiche des totaux **cumulés sur le cycle de facturation**, pas des débits. Lire "ISR Writes : 3.1M" ne dit rien tant qu'on ne sait pas depuis combien de jours le cycle court. La seule mesure exploitable est la différence entre deux relevés espacés de 24 heures, à la même heure.

### 2.2 Relevé de référence, à faire avant la règle 1

Deux passages sur la page **Usage** (Dashboard équipe → onglet Usage), à H et à H+24, en notant l'heure exacte. La différence donne le débit quotidien de référence.

| Compteur | Valeur de référence attendue, par jour | Où |
|---|---|---|
| Function Invocations | 26 290 | Usage → Functions |
| ISR Writes | 78 065 | Usage → ISR |
| ISR Reads | 10 645 | Usage → ISR |
| Edge Requests | 32 419 | Usage → Edge |
| Fast Origin Transfer | 1.47 GB | Usage → Data Transfer |
| Observability Events | 75 806 | Usage → Observability |
| Fluid Active CPU | 27 min | Usage → Fluid Compute |
| Fluid Provisioned Memory | 5.92 GB·h | Usage → Fluid Compute |

Ces valeurs viennent de la division des totaux de la facture par 62 jours. Si ton relevé sur 24h s'écarte de plus de 30 % de la colonne ci-dessus, c'est que le trafic a bougé depuis la période auditée, et c'est ton relevé qui fait foi pour la suite.

En parallèle, sur l'onglet **Firewall** :

1. Les quatre compteurs du bandeau 24h : Allowed 40 100, Denied 23, Challenged 72, Rate Limited 0.
2. Firewall → Traffic, capture des cinq panneaux : Top JA4, Top User Agents, Top AS Names, Top Paths, Top IPs.
3. Le total de requêtes sur les chemins commençant par `/api/`, additionné à la main depuis Top Paths. C'est le dénominateur qui permettra d'expliquer l'écart entre le gain prévu et le gain constaté sur la règle 4.

### 2.3 L'oracle indépendant : le compteur de vues humaines

C'est le point le plus important de tout ce document. Il existe déjà, il est gratuit, et il ne dépend d'aucun compteur Vercel.

La table `page_view` n'est écrite que par `POST /api/track`, appelé depuis deux endroits, tous deux côté client : `src/app/[owner]/[repo]/page.client.tsx:220` et `src/app/profile/[login]/page.client.tsx:329`. Cette route est classée en tier `post` par `src/proxy.ts:236`, donc elle exige le cookie HMAC posé par le middleware au chargement de page (`src/proxy.ts:468-472`). Conclusion : **une ligne de `page_view` prouve qu'un navigateur a exécuté du JavaScript et portait un cookie de session**. Un bot sans moteur JS n'en produit jamais.

Le digest quotidien de 06:00 UTC lit déjà ce compteur et te l'envoie par mail : `src/app/api/admin/daily-digest/route.ts:39-43` remonte `todayViews` groupé par type, et `:46-49` le top 10 des repos sur 7 jours.

Protocole : note les valeurs `todayRepo` et `todayProf` des sept digests précédant J0, calcule la moyenne et l'écart-type. C'est ta ligne de base humaine. Si elle chute de plus de 25 % après la mise en service d'une règle, tu bloques de vrais utilisateurs, quel que soit ce que raconte le panneau Firewall.

### 2.4 Seuils de succès

Relevés à J+2 puis à J+7, sur 24h glissantes.

| Métrique | Référence/jour | Cible | Seuil d'échec |
|---|---|---|---|
| Firewall Allowed | 40 100 | 12 000 à 18 000 | > 30 000 à J+2 : les règles ne matchent pas, va lire le journal d'événements |
| Function Invocations | 26 290 | 9 000 à 14 000 | baisse < 25 % à J+2 |
| ISR Writes | 78 065 | 24 000 à 38 000 | baisse < 25 % à J+2 |
| Fast Origin Transfer | 1.47 GB | 0.50 à 0.90 GB | pas de baisse |
| Observability Events | 75 806 | incertain, voir ci-dessous | aucun |
| `page_view` du jour | moyenne 7j | à ±15 % de la moyenne | **chute > 25 %** |
| Taux de résolution du challenge | néant | < 5 % | **> 30 %** |

Sur Observability, je ne peux pas garantir qu'une requête arrêtée par le WAF cesse d'émettre un événement. Ce qui est certain, c'est qu'elle n'exécute aucune fonction, donc les invocations et les écritures ISR tombent. Pour les Edge Requests et les événements Observability, la seule preuve est la mesure. Si à J+2 les invocations ont chuté de 60 % mais que les événements Observability n'ont bougé que de 20 %, alors la ligne à $2.76/mois du rapport n'est récupérable qu'en partie, et le total réaliste passe de $10-12 à $8.50-10.50/mois. Ne parie pas dessus avant de l'avoir lu.

Le taux de résolution du challenge se lit dans Firewall → journal d'événements, en filtrant sur le nom de règle `challenge-ja4-pages` : Vercel distingue les challenges servis de ceux résolus. Un taux proche de zéro confirme l'automatisation. Un taux au-dessus de 30 % signifie que la règle attrape des humains.

---

## 3. Plan de rollback

Une règle Vercel se désactive en un clic depuis Firewall → Custom Rules → le toggle de la règle. Le retour arrière prend moins de trente secondes et se propage en quelques secondes sur le réseau. Il n'y a pas de redéploiement, donc pas de raison d'hésiter.

| Règle | Critère de déclenchement chiffré | Action de rollback | Alternative après rollback |
|---|---|---|---|
| 1. allow-public-embeds | Aucun. Ne la désactive jamais. | néant | néant |
| 2. allow-verified-crawlers | Aucun. | néant | Restreindre par ASN si abus d'UA constaté |
| 3. deny-vuln-scanners | Un chemin légitime apparaît dans le journal des Denied | Retirer la chaîne fautive de la condition | néant |
| 4. challenge-ja4-pages | Taux de résolution du challenge **> 30 %**, ou `page_view` du jour **en baisse de plus de 25 %** vs la moyenne 7j | Repasser l'action de Challenge à **Log** | Ajouter `AND AS Number in (hébergeurs)` pour ne challenger que le trafic datacenter |
| 5. deny-hosting-asn | Un signalement utilisateur, ou `page_view` en baisse **> 15 %** dans les 24h suivant l'activation | Désactiver la règle entière, puis la réactiver AS par AS | Passer l'action de Deny à **Challenge** sur les AS douteux |
| 6. ratelimit-pages | Compteur **Rate Limited > 2 000/24h**, ou un rapport de scan interrompu | Désactiver, puis remonter le seuil à 120/60 s | Changer la clé de IP à JA4 si l'UI le propose |
| 7. deny-ja4-datacenter | Toute baisse mesurable de `page_view` | Désactiver, revenir au Challenge de la règle 4 | Ne pas réessayer |
| Bot Protection | Une seule requête `/api/` challengée dans le journal | Désactiver le toggle | Reprendre uniquement par règles custom |
| Deployment Protection | Un service externe casse sur une URL de preview | Repasser en Disabled, ou ajouter un Protection Bypass | néant |

Deux signaux qui imposent un rollback immédiat, sans attendre la fin de la fenêtre d'observation. Le premier : une requête sur `/api/badge/` ou `/api/map-image/` apparaît en Denied ou Challenged dans le journal. Cela veut dire que la règle 1 est mal placée ou mal écrite, et que des badges affichés dans des README publics sont cassés en ce moment même. Le second : les Crawl Stats de Google Search Console montrent une chute du nombre de pages explorées par jour, ou l'apparition d'erreurs de type "Blocked due to other 4xx issue". La perte SEO ne se voit pas dans les compteurs Vercel et met des semaines à se rattraper.

---

## 4. Réglages hors WAF

### 4.1 Deployment Protection

Chemin : Project Settings → **Deployment Protection** → **Vercel Authentication** → passer à **Standard Protection**.

Le panneau montre `starmapper-bvoqo2f24-florianbrunia…` à 118 requêtes sur 24h. Une URL de preview qui reçoit du trafic public consomme le même quota que la prod et expose du code non finalisé.

Avant d'activer, vérifie qu'aucun service externe ne consomme les previews : un Lighthouse CI, un webhook de test, un lien de recette partagé. Si c'est le cas, ajoute un **Protection Bypass for Automation** sur la même page plutôt que de renoncer.

Gain : $0.05/mois. Une minute. Le vrai bénéfice est la surface d'exposition, pas l'argent.

### 4.2 Observability

Chemin : Team Settings → **Billing** → détail de la souscription, chercher une ligne "Observability Plus".

La facture auditée ne montre que la ligne d'ingestion `Observability Events 4.7M / $5.64`, sans forfait associé. Cela suggère que l'add-on n'est pas souscrit. Si tu ne le trouves pas dans les lignes d'abonnement, il n'y a rien à faire et l'économie de $0.30/mois annoncée en section 7.1 du rapport n'existe pas : sur le plan de base, la rétention n'est pas un réglage exposé. Dis-le franchement plutôt que de chercher un sélecteur qui n'est pas là.

Le seul levier réel sur cette ligne reste la baisse du volume de requêtes, traitée en section 1.

### 4.3 Bot Protection

Chemin : Firewall → **Bot Protection**. État actuel : **Inactive**.

Ne l'active pas au jour 0. C'est le réglage le plus dangereux de la liste, pour une raison précise : c'est un toggle global qui ne distingue pas les chemins. Il s'appliquera à `/api/mcp/*`, à `/api/badge/*`, aux flux RSS et JSON de `/api/feed/[login]/`, et aux 1210 POST de la boucle de chunk sur un gros repo. Aucun de ces clients ne sait résoudre un challenge.

Deux vérifications avant d'y toucher, dans cet ordre. D'abord, confirmer que les règles Allow 1 et 2 sont bien évaluées **avant** le ruleset managé chez Vercel. Si l'UI ne le garantit pas explicitement, n'active pas. Ensuite, ouvrir le détail des catégories et regarder si les crawlers IA forment une catégorie distincte avec une action par défaut de blocage : `src/app/robots.ts:17-29` invite explicitement GPTBot, ClaudeBot, PerplexityBot et six autres, et une catégorie "AI bots" activée par défaut mettrait le WAF en contradiction directe avec ce fichier.

Verdict : à décider à J+7, sur données, avec un rollback armé. Le gain marginal après les règles 4 et 5 est faible.

### 4.4 Managed Rulesets

Chemin : Firewall → **Managed Rules**. Le ruleset OWASP protège contre l'injection et les traversées de chemin. Il n'apporte aucune économie et introduit un risque de faux positif sur les paramètres de requête. StarMapper valide déjà ses entrées par Zod (`src/schemas/`) et n'a pas de SQL concaténé. Priorité basse, à traiter comme un sujet de sécurité séparé, pas comme un levier de coût.

### 4.5 La mémoire des fonctions, un levier que l'audit n'a pas vu

Chemin : Project Settings → **Functions** → configuration CPU/mémoire.

Les deux lignes Fluid pèsent $8.07 sur 62 jours, soit **$3.96/mois, 18 % de la facture** : Active CPU $4.07 et Provisioned Memory $4.00. La mémoire provisionnée se facture au GB·heure d'allocation, donc elle est directement proportionnelle au réglage. Passer de 2 GB à 1 GB diviserait cette ligne par deux, environ $1.85/mois.

Le piège, et il est sérieux : chez Vercel Fluid, la puissance CPU allouée est indexée sur la mémoire. Diviser la mémoire par deux allonge les traitements réellement gourmands en CPU, ce qui reporte le coût sur la ligne Active CPU et rapproche les crons de leur `maxDuration`. Trois routes sont sur le fil : `src/app/api/admin/refresh-grid-mv/route.ts:24`, `src/app/api/admin/refresh-repo-stats/route.ts:39` et `src/app/api/admin/refresh-trending/route.ts:24` déclarent toutes `maxDuration = 300`, et la part 2 du refresh repo-stats consomme déjà environ 185 s d'après les mesures consignées en commentaire (`refresh-repo-stats/route.ts:18-19`).

Ces trois-là passent la quasi-totalité de leur temps à attendre Postgres, pas à calculer, donc elles devraient peu souffrir. Le vrai risque est sur `/api/chunk` (`maxDuration = 60`, `src/app/api/chunk/route.ts:18`), qui fait du geocoding et de la sérialisation. Protocole : baisser à 1 GB sur un déploiement de preview, lancer un scan de repo moyen, comparer la durée par chunk. Si elle augmente de moins de 20 %, garder. Sinon, revenir.

Gain estimé : $1.00 à $1.85/mois, à valider par test. À traiter à J+7, une fois le bruit du WAF retombé.

---

## 5. Les crons

### 5.1 Ce qu'ils coûtent réellement

Six entrées dans `vercel.json:2-27`. Fréquence quotidienne : 6 passages pour `refresh-grid-mv` (`0 */4 * * *`), 4 pour `refresh-trending` (`30 */6 * * *`), 2 + 2 pour `refresh-repo-stats` parts 1 et 2 (`0 2,14` et `20 2,14`), 1 pour `daily-digest`, et 1 par mois pour `cleanup`. Total : **15 invocations par jour**.

Sur 62 jours cela fait 932 invocations, soit **0.057 % des 1.63M facturées**, pour un coût de $0.0004 au tarif dérivé de $0.48/M. La ligne Function Invocations n'est pas un sujet.

Le temps d'horloge est le seul poste qui compte, parce que Fluid facture la mémoire provisionnée sur toute la durée d'allocation. Les durées mesurées ou bornées :

| Cron | Passages/jour | Durée par passage | Secondes/jour |
|---|---|---|---|
| `refresh-repo-stats?part=1` | 2 | 122 s, mesuré (`route.ts:18`) | 244 |
| `refresh-repo-stats?part=2` | 2 | 185 s, mesuré (`route.ts:19`) | 370 |
| `refresh-trending` | 4 | budget de boucle 240 s (`route.ts:76`) + refresh MV, plafond 300 s | 240 à 1200 |
| `refresh-grid-mv` | 6 | non mesurable, `pg_stat_statements` absent en prod (`refresh-repo-stats/route.ts:25`), plafond 300 s | 360 à 1800, estimation centrale 720 |
| `daily-digest` | 1 | 5 requêtes Prisma parallèles + un envoi Resend, estimation 10 s | 10 |

Total : entre 1 224 et 3 624 secondes par jour, estimation centrale **2 400 s/jour, soit 0.67 heure d'horloge**.

Le compteur global vaut 5.92 GB·h/jour. À 2 GB par instance, cela représente 2.96 heures d'allocation par jour toutes fonctions confondues. Les crons en consomment donc **environ 23 %**, soit $0.90 sur 62 jours, **$0.44/mois**. La borne haute du calcul monte à $0.66/mois. Confirme le 2 GB via l'inventaire #6, la proportion s'ajuste linéairement.

Côté Active CPU, `REFRESH MATERIALIZED VIEW CONCURRENTLY` est de l'attente réseau pure : la fonction ne consomme pas de CPU pendant que Neon travaille. C'est précisément ce que Fluid ne facture pas. Contribution estimée sous 5 % des 28 heures. Méthode de vérification : Observability → Functions, grouper par route, lire la colonne de temps CPU sur `/api/admin/`.

### 5.2 Les invalidations de cache induites : quasi nulles, et pour une raison instructive

`refresh-grid-mv/route.ts:95-96` appelle `revalidateTag("trending", "hours")` et `revalidateTag("explore-mvs", "hours")`. `refresh-trending/route.ts:103` rappelle `revalidateTag("trending", "hours")`. `refresh-repo-stats` n'invalide rien, et le commentaire ligne 178 explique pourquoi : rien ne met ces vues en cache côté Next.

Or les entrées visées expirent déjà toutes seules, bien plus vite que la fréquence des crons. `src/lib/trending-query.ts:42` et `:82` déclarent `cacheLife({ revalidate: 300, stale: 3600 })`, soit une réécriture possible toutes les 5 minutes. `src/lib/devs-query.ts:41`, `:93` et `:111` déclarent `revalidate: 3600`, une heure. Une invalidation toutes les 4 ou 6 heures sur des entrées qui se périment en 5 minutes ou en 1 heure n'ajoute rien : au pire une réécriture supplémentaire par passage, soit une dizaine par jour.

**Les crons ne contribuent pas mesurablement aux 78 065 écritures ISR quotidiennes.** En revanche, ce calcul met au jour une source que l'audit n'avait pas isolée : `/trending` a un `revalidate` de 300 secondes, donc sous trafic continu la page se réécrit jusqu'à 288 fois par jour, indépendamment de tout cron. C'est petit à l'échelle des 78k, mais c'est un candidat gratuit à l'allongement une fois le trafic bot parti.

### 5.3 Verdict sur les fréquences

**Ne touche pas aux crons pour des raisons de coût.** Ils pèsent $0.44/mois, soit 2 % de la facture, et le gain maximum d'un dégraissage agressif est de $0.20 à $0.25/mois. Le temps passé à les régler rapporte cinquante fois moins que les quinze minutes de WAF.

Si tu y touches quand même, par exemple pour soulager Neon, une seule contrainte est non négociable. `repo_power_users_mv` lit `power_users_mv`, qui est reconstruite par `refresh-grid-mv`. La part 1 de `refresh-repo-stats` tourne à 02:00 et 14:00. Il faut donc garder un passage de `refresh-grid-mv` strictement avant chacun de ces créneaux, avec assez de marge pour absorber son plafond de 300 s. La planification `0 0,12 * * *`, deux passages au lieu de six, satisfait la contrainte avec presque deux heures de marge dans les deux cas. Coût de freshness : les données de `/devs/atlas` peuvent atteindre 12 heures d'âge au lieu de 4, sachant que `src/lib/devs-query.ts:41` autorise déjà une heure de péremption côté Next par-dessus.

`refresh-trending` à 4 passages par jour est le plus gros consommateur d'horloge de la liste, à cause de son budget de boucle de 240 s. C'est aussi la fonctionnalité la plus visible du site. Laisse-le tel quel.

---

## 6. Calendrier

### Aujourd'hui, environ 50 minutes

1. Inventaire de la section 0, dix minutes, dans un fichier à part.
2. Premier relevé Usage et Firewall, section 2.2. Note l'heure.
3. Création des règles 1, 2 et 3, actives immédiatement. Trois minutes chacune.
4. Création des règles 4 et 5 en action **Log**. Publier.
5. Deployment Protection en Standard Protection, après vérification qu'aucune automatisation externe ne consomme les previews.
6. Ouvre le mail du digest de ce matin, note `todayRepo` et `todayProf`. Fais de même sur les six mails précédents.

Gain immédiat : $0.30 à $0.85/mois, uniquement la règle 3 et la protection des previews. Le vrai livrable de la journée n'est pas l'économie, c'est le filet de sécurité et la ligne de base.

### Demain, J+1, environ 20 minutes

1. Deuxième relevé Usage. La différence avec celui d'hier donne le débit de référence réel.
2. Firewall → journal d'événements, filtre sur `challenge-ja4-pages` en mode Log. Compte les correspondances sur 24h et ouvre une dizaine d'entrées au hasard : regarde le chemin, l'ASN, le referer. Si tu y trouves du trafic manifestement humain, affine la condition avant de basculer.
3. Bascule la règle 4 de Log à **Challenge**.
4. Vérifie le digest du matin : `todayRepo` doit être dans la fourchette habituelle.

Gain attendu à partir de ce point : $6.00 à $9.00/mois, qui ne sera visible dans les compteurs qu'à partir de J+2.

### J+2, environ 30 minutes

1. Relevé Usage complet. Compare aux seuils de la section 2.4.
2. Lis le taux de résolution du challenge. Sous 5 %, le diagnostic d'automatisation est confirmé. Au-dessus de 30 %, rollback en Log et reprends l'analyse.
3. Lis les correspondances de la règle 5 en Log, AS par AS. Active le Deny **seulement** sur ceux dont l'échantillon ne montre aucun trafic plausiblement humain.
4. Crée la règle 6, rate limit sur les pages.
5. Vérifie le digest.

Cumul attendu : $8.00 à $11.00/mois. Facture infra projetée : $11 à $14/mois.

### J+7, environ 45 minutes

1. Relevé Usage sur une semaine pleine. C'est le chiffre qui compte, les fluctuations quotidiennes ne veulent rien dire.
2. Compare `page_view` sur les 7 jours post-règles contre les 7 jours pré-règles. C'est la preuve finale que tu n'as pas blessé de vrais utilisateurs.
3. Ouvre Google Search Console → Crawl Stats. Vérifie que le nombre de pages explorées par jour n'a pas décroché.
4. Décide de la règle 7 sur la base du taux de résolution du challenge.
5. Décide de Bot Protection, avec les deux vérifications de la section 4.3.
6. Teste la mémoire à 1 GB sur un déploiement de preview, section 4.5.

Cumul attendu : **$10.00 à $13.00/mois**, avec une incertitude assumée de plus ou moins $3.00. Facture infra projetée : **$9.00 à $12.00/mois**, avant tout gain du travail applicatif mené en parallèle.

Les deux sources principales d'incertitude, nommées : la part du trafic JA4 qui tape `/api/` et échappe donc à la règle 4, et le comportement de facturation des événements Observability sur les requêtes bloquées. Les deux se lisent dans les compteurs, aucune ne se devine.

---

## 7. Risques

### 7.1 La boucle de chunk contre le rate limit du WAF

Le risque le plus concret de tout ce plan. La boucle est orchestrée par le navigateur, cent utilisateurs par appel, et poste sur `/api/chunk` jusqu'à ce que le curseur soit épuisé. Pour un repo à 121 000 étoiles, cela fait 1 210 POST depuis une seule adresse IP. Le limiteur applicatif les plafonne à 30 par minute (`src/proxy.ts:56`), donc le scan dure au minimum 40 minutes en régime nominal.

Une règle WAF de rate limit qui ne dépasserait pas explicitement `/api/` couperait ce scan en cours de route. L'utilisateur verrait la carte se figer, sans message, et aucun log applicatif n'expliquerait rien puisque la requête n'aurait jamais atteint le middleware. C'est pour cette raison que la règle 6 porte la condition `Request Path does not start with /api/`, et cette condition ne doit jamais être retirée "pour simplifier".

### 7.2 Le challenge contre tout ce qui n'est pas un navigateur

Un challenge managé exige JavaScript et cookies. Sept familles de clients de StarMapper n'ont ni l'un ni l'autre : le proxy camo de GitHub sur `/api/badge/` et `/api/map-image/`, les neuf familles de routes MCP sous `src/app/api/mcp/`, les flux `/api/feed/[login]/rss` et `/json`, les appels `curl` documentés, les intégrations tierces sur `/api/geo/`, et la boucle de chunk elle-même dont les XHR ne portent pas de contexte de navigation exploitable par un challenge intermédiaire.

Bot Protection est le vecteur le plus probable de cet accident, parce que c'est un interrupteur global sans granularité de chemin. C'est la raison pour laquelle il arrive en dernier dans le calendrier, avec deux vérifications préalables et un critère de rollback à une seule requête.

### 7.3 Double comptage avec le rate limiting applicatif : il n'y en a pas, mais l'ordre a une conséquence

`src/proxy.ts:408-429` retourne pour toute requête de page avant d'avoir consulté le moindre limiteur : les pages ne sont rate-limitées nulle part aujourd'hui. Les limiteurs Upstash de `TIER_LIMITERS` (`src/proxy.ts:102-118`) et de `POST_ROUTES` (`:52-95`) ne s'appliquent qu'à `/api/`. La règle 6 exclut `/api/`. Les deux mécanismes couvrent donc des ensembles disjoints, sans double comptage et sans conflit de quota.

L'ordre d'évaluation a en revanche une conséquence économique directe. Le WAF s'exécute à la périphérie, avant le middleware. Un 429 émis par `src/proxy.ts:329-339` est donc rendu **après** que l'Edge Request et l'exécution du middleware ont été facturées, plus un aller-retour vers Upstash. Une coupure au WAF ne coûte rien de tout cela. Autrement dit, le rate limiting applicatif protège la base de données et le quota GitHub, il ne protège pas la facture Vercel. Les deux couches sont complémentaires, pas redondantes.

### 7.4 Le cookie posé sur chaque requête de page sans session

`src/proxy.ts:415-427` : quand `SM_TOKEN_SECRET` est défini et que la requête n'apporte pas de cookie valide, le middleware génère un jeton HMAC et pose un `Set-Cookie`. Un bot ne conserve jamais de cookie, donc **chaque requête de bot sur une page paie une génération de jeton et un en-tête `Set-Cookie`**. Une réponse portant un `Set-Cookie` n'est en général pas mutualisable dans un cache partagé, ce qui pourrait expliquer une partie de l'incapacité du CDN à servir les coquilles de page sans invoquer la fonction.

Je ne peux pas confirmer ce dernier point depuis le repo, Next.js et Vercel ayant un traitement particulier des cookies posés par le middleware. Vérification en une commande :

```bash
curl -sI https://starmapper.bruniaux.com/vercel/next.js | grep -i 'x-vercel-cache\|set-cookie\|age'
```

Un `x-vercel-cache: MISS` sur deux appels consécutifs à quelques secondes d'intervalle, avec un `set-cookie` présent, confirmerait l'hypothèse. Dans tous les cas, ce coût disparaît mécaniquement avec le trafic bot.

### 7.5 SEO et crawlers IA

`src/app/robots.ts:17-29` invite explicitement onze agents, dont GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot et Google-Extended. Le sitemap (`src/app/sitemap.ts`) leur offre environ 1 300 URL. Un WAF qui les challenge ou les bloque crée une contradiction que rien ne signale : le trafic disparaît des compteurs, la visibilité disparaît des réponses des assistants, et personne ne fait le lien avant plusieurs semaines.

La règle 2 les protège nominativement. Le danger vient de Bot Protection, dont les catégories managées peuvent inclure les crawlers IA avec une action de blocage par défaut. Vérifie avant d'activer, pas après.

Deuxième angle mort : la règle 5 bloque des ASN d'hébergement. Certains crawlers IA de second rang sortent de datacenters sans être dans la liste Verified Bots de Vercel. Ils tomberont. C'est un arbitrage assumé, pas un accident, mais il faut le savoir.

### 7.6 VPN d'entreprise et proxys de sécurité

Zscaler, Netskope, Cloudflare WARP et les passerelles d'entreprise font sortir leurs utilisateurs par des adresses d'hébergement. Un Deny sur ASN les coupe silencieusement : côté utilisateur, le site paraît en panne, et il n'existe aucun canal pour qu'il te le dise. Datacamp, M247 et FDCservers sont des hébergeurs de sortie VPN classiques, ce qui veut dire qu'ils portent aussi des utilisateurs finaux payants pour un VPN grand public.

C'est l'argument central pour préférer le **Challenge** au **Deny** partout où le doute existe. Un abonné VPN résout le challenge et passe. Un scraper ne passe pas.

### 7.7 MCP et ASN datacenter

Les neuf familles de routes sous `src/app/api/mcp/` sont conçues pour des clients machine. Un client MCP local sort par une IP résidentielle, un client hébergé sort par AWS, GCP ou n'importe quel hébergeur. La règle 5 porte `AND Request Path does not start with /api/mcp/` exactement pour cette raison, et la liste d'ASN exclut Amazon et Google Cloud.

Reste un risque résiduel : trois routes MCP sont classées en tier `mcp-github` par `src/proxy.ts:273-277` et, sans en-tête `x-gh-token`, retombent sur un limiteur à 10 requêtes par minute (`src/proxy.ts:117`). Un intégrateur qui découvre l'API sans PAT sera déjà limité par l'application. Ajouter une couche WAF par-dessus rendrait le diagnostic impossible à distance. Laisse `/api/mcp/` entièrement hors du périmètre WAF.

### 7.8 Le digest JA4 va dériver

Chrome publie une version majeure toutes les quatre semaines environ, et sa pile TLS évolue. Le digest `t13d1516h2_…` finira par ne plus correspondre à rien. Une règle qui cesse de matcher ne produit aucune alerte : le panneau Firewall affiche zéro correspondance, ce qui ressemble à un succès, et la facture remonte sur deux ou trois cycles avant que quelqu'un s'en aperçoive.

Parade : le premier de chaque mois, ouvrir Firewall → Traffic → Top JA4 et comparer au digest de la règle. Si le nouveau dominant est différent, mettre la règle à jour. Cinq minutes par mois.

### 7.9 Attribution impossible si le WAF et le code bougent ensemble

Un autre agent travaille en parallèle sur la compression des réponses, sur les `cacheLife` de `src/app/[owner]/[repo]/page.tsx:26`, `:41` et `:54`, et sur les quatorze `next/image`. Plusieurs de ces lots mordent sur les mêmes lignes de facture que le WAF : Fast Origin Transfer et ISR Writes.

Si les deux lots partent dans la même fenêtre de 48 heures, aucune des deux économies ne sera attribuable, et en cas de régression tu ne sauras pas laquelle défaire. Séquence recommandée : WAF d'abord, mesure à J+2, puis le code. Si le calendrier ne le permet pas, accepte explicitement de ne jamais savoir lequel a payé.

Rappel du rapport, section 7.3 : les deux effets ne s'additionnent pas. Une fois 65 % du trafic coupé, l'économie de l'allongement des `cacheLife` tombe de $2.40 à environ $0.85, parce qu'il ne reste plus grand-chose à réécrire.

Correction du 2026-08-16 sur l'item 9 de l'audit, retirer `compress: false` de `next.config.ts:9`. Vérification faite dans le build local : `router-server.js:114-117` est le seul consommateur du middleware de compression, et il est gardé par `if (config?.compress !== false)`. Or ni `.next/next-minimal-server.js.nft.json` (85 fichiers tracés) ni `.next/next-server.js.nft.json` (698 fichiers) ne référencent `next/dist/compiled/compression`. Les deux bundles serveur que Next.js émet pour les plateformes de déploiement n'embarquent donc pas le module. Passer `compress` à `true` ne peut rien activer dans un bundle qui ne contient pas le code. Le gain de $2.20/mois annoncé en section 7.2 du rapport tombe à $0.00, et la trajectoire de la section 7.3 du rapport doit être relue en le retirant. Reste une incertitude nommée : les traces `.nft.json` décrivent ce que Next.js déclare nécessaire, pas ce que le lanceur `@vercel/next` instancie réellement, et ce lanceur n'est pas présent dans `node_modules`. Le compteur Fast Origin Transfer à J+1 tranche.

Conséquence pour ce plan : la compression explicite dans les handlers devient le seul levier sur les 91 GB, ce qui déplace le lot correspondant de "optionnel" à prioritaire. La contrainte de séquencement ci-dessus reste valable et s'applique désormais à ce lot-là.

### 7.10 Les règles WAF ne sont pas dans git

Elles vivent uniquement dans le dashboard Vercel. Pas de revue, pas de diff, pas d'historique exploitable au-delà de ce que Vercel conserve. Dans trois mois, personne ne se souviendra pourquoi tel numéro d'AS est refusé ni sur quelle donnée la décision a été prise.

Ce fichier est le registre. Chaque fois qu'une règle change, ajoute une ligne datée en fin de section 1.3 avec la valeur avant, la valeur après et le chiffre qui a motivé le changement.

---

## 8. Ce que ce plan ne couvre pas

Trois choses, dites franchement.

La règle 4 vise le digest JA4 dominant, qui pèse 75 % du trafic. Les 25 % restants ne sont pas analysés ici faute de données : le panneau Top JA4 ne montre que les premières entrées. Si après J+7 les invocations n'ont baissé que de 40 % au lieu des 65 % visés, l'explication est probablement là, et la marche à suivre est de relire le Top JA4 sur le trafic résiduel.

Le comportement de facturation de Vercel sur les requêtes bloquées est vérifié pour les invocations de fonction, qui ne s'exécutent pas. Il ne l'est pas pour les Edge Requests ni pour les événements Observability. Les fourchettes de gain de ce document supposent que ces deux lignes baissent proportionnellement. Si la mesure à J+2 dit le contraire, retire environ $2.00/mois de toutes les projections.

La contribution des crons est calculée en supposant 2 GB de mémoire par instance et une durée centrale de 120 s pour `refresh-grid-mv`, qui n'est pas mesurable en prod puisque `pg_stat_statements` n'y est pas installé (`src/app/api/admin/refresh-repo-stats/route.ts:25`). La conclusion, à savoir que les crons pèsent 2 à 3 % de la facture et ne méritent aucun arbitrage, tient sur toute la fourchette, du minimum de 1 224 s/jour au maximum de 3 624 s/jour. Elle ne dépend donc pas de l'estimation.
