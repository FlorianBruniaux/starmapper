# StarMapper Roadmap

*Dernière mise à jour : 2026-04-10, Language Atlas + Dev Maps shipped (v0.3.0)*

---

## Fait ✅

- **Badge README dynamique** : `/api/badge/[owner]/[repo]` SVG shields-style, cache CDN 6h. Bouton sidebar + section Share modal avec preview live + copy Markdown.
- **Repo bookmarks** : localStorage, liste des derniers repos scannés sur la landing.
- **Share card** : export PNG carte + stats, partage LinkedIn avec texte pré-rempli.
- **Compression client-side cache** : Web CompressionStream (gzip+base64) avant écriture `POST /api/stargazer-cache`. Résout les timeouts sur repos 50k+ étoiles.
- **Geocache pre-seeding** : ~51k entrées GeoNames (villes + pays), >99% hit rate sur scans réels.
- **Stargazer Intelligence, Phase 1** : Stats panel enrichi avec 6 summary cards (total stars), company badges sur Top Stars, sort toggle, nouveau tab ⚡ Power (cross-repo power stargazers via query `groupBy` sur `star_event`).
- **Language Atlas** : `/devs/atlas`, carte choroplèthe mondiale, langage le plus populaire par pays. Données issues des repos étoilés + contribués. Bandeau "Early preview" le temps du backfill complet.
- **Dev Maps par langage** : `/devs` + `/devs/[language]`, carte des développeurs filtrée par langage.

---

## Quick wins (1-2h chacun)

- **Heatmap mode** : toggle dots ↔ densité de chaleur. Plus lisible sur les grands repos (50k+ stars). MapLibre supporte nativement le layer `heatmap`.
- **Multi-repo** : comparer deux repos sur la même carte (audiences qui se chevauchent). Star-history le fait pour les graphes, personne ne le fait géographiquement.
- **API publique GeoJSON** : `/api/geo/[owner]/[repo]` retourne le GeoJSON du scan. Pour chercheurs, journalistes, devs qui veulent builder dessus.

---

## Features moyen terme

- **Watch mode** : poll toutes les X minutes, affiche "+3 new stars in Paris" avec un badge qui pulse. Utile pour les lancements et les moments de traction.
- **Company breakdown** : on a déjà `company` dans les données. Top 20 companies qui star ton repo, avec logo si dispo via Clearbit. Très parlant pour le B2B.
- **Animated timelapse** : rejouer l'arrivée des stars dans le temps sur la carte. `StarEvent.starredAt` est déjà stocké. Satisfaisant à regarder, très partageable.
- **Vue historique géo** : stocker des snapshots géo par date (pays x date x count). Permet d'"animer" l'évolution géographique. Nécessite un scan périodique en background.

---

## Intégration Jawg Places JS

Jawg fournit une lib d'intégration native pour l'autocomplete et le reverse geocoding : [Jawg Places JS](https://www.jawg.io/docs/integration/places-js/). Elle transforme n'importe quel input en barre de recherche avec interactions sur la carte (suggestions live, fly-to sur sélection).

Intérêt pour l'explore page : remplacer les routes `/api/explore/autocomplete` + `/api/explore/geocode` maison (qui font un simple proxy vers `api.jawg.io`) par la lib officielle côté client. Moins de code serveur, meilleure UX (suggestions instantanées sans round-trip).

Prérequis : bundle size à évaluer, compat MapLibre GL à tester.

---

## Distribution / open source

- **Extension Chrome** — bouton sur chaque page GitHub `/repo`, ouvre le map sans quitter GitHub. C'est le vrai multiplicateur d'usage (cf. star-history.com).
- **Embeddable widget** — `<iframe src="starmapper.bruniaux.com/embed/owner/repo">` pour les READMEs. Carte interactive intégrable.
- **CLI** — `npx starmapper owner/repo` → génère un `map.html` standalone. Pour les devs qui veulent un artefact offline.

---

## Stargazer Intelligence (nouveau axe)

On accumule des milliers de profils GitHub en base (`github_user` + `star_event`). L'idée : exploiter ces données pour créer de nouveaux points d'entrée vers StarMapper, au-delà du repo.

### ~~Phase 1 : Stats panel enrichi~~ ✅ Shipped 2026-03-28

- Stats panel : 6 summary cards, sort toggle Top Stars, company badges, tab ⚡ Power
- `/api/stats` : `company` dans `topUsers`, nouveau champ `powerStargazers` (cross-repo `groupBy`)

### ~~Phase 2 : Page `/explore` (leaderboard global)~~ ✅ Shipped

Page standalone, nouveau point d'entrée vers StarMapper. Exploite toute la base cross-repo.

- **Classements globaux** : top stargazers by followers, by repos starred (cross-repo), by publicRepos
- **Top companies** : agrégation globale, pas liée à un repo
- **Top locations / countries** : "les villes qui starent le plus"
- **Filtrable** : par pays, company, tranche de followers
- **Lien vers les repos** : chaque user → liste des repos StarMapper où il apparaît

**Endpoint** : `GET /api/explore` (query Prisma `GROUP BY` sur `star_event` + `JOIN github_user`).

**Valeur** : nouveau funnel d'acquisition. Aujourd'hui on entre par un repo. Demain on entre aussi par un dev ou une company.

### Phase 3 : Page `/profile/[login]` (profil stargazer)

Page dédiée par utilisateur GitHub. Le "reverse lookup" : au lieu de "qui stare ce repo ?", c'est "quels repos ce dev stare ?".

- **Repos starés** : tous les repos StarMapper que ce user a staré, avec dates
- **Position sur la map** : mini-carte si géocodé
- **Stats** : followers, publicRepos, company, account age
- **"Repos en commun"** : autres stargazers du même coin géographique ou de la même company
- **Pages indexables** : chaque login = une page. SEO massif (milliers de pages potentielles)

**Endpoint** : `GET /api/profile/[login]` (lecture `github_user` + `star_event` WHERE login).

**Risques identifiés** :
- Volume en base : si <1k users, le leaderboard est creux. Valider le volume avant de lancer la Phase 2.
- Fraîcheur : `followers` date du dernier scan. Un user scanné il y a 3 mois peut avoir évolué. Prévoir un mécanisme de refresh (ou afficher "data from {fetchedAt}").
- Privacy : tout est public GitHub, mais un classement de personnes mérite au minimum un lien clair vers la source GitHub.
- Neon 512MB : pas de nouveau stockage, mais les `GROUP BY` sur tables larges nécessitent des index. À benchmarker.

---

## Si monétisation un jour

- **Trending page** — "Ces repos recrutent des stars à Paris cette semaine." Trafic organique.
- **Alertes email** — "10 nouveaux stargazers cette semaine, 3 de chez Microsoft". Rétention + upsell naturel.

---

**Ordre de priorité suggéré** :

1. ~~**Stats panel enrichi**~~ ✅
2. **Page `/explore`** (Phase 2) : nouveau funnel d'acquisition
3. **Page `/profile/[login]`** (Phase 3) : SEO massif
4. **Heatmap mode** : natif MapLibre, rapide
5. **Multi-repo** : différenciation forte vs star-history
6. **Extension Chrome** : multiplicateur de surface
