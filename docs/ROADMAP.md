# StarMapper — Roadmap

*Dernière mise à jour : 2026-03-27*

---

## Fait ✅

- **Badge README dynamique** — `/api/badge/[owner]/[repo]` SVG shields-style, cache CDN 6h. Bouton sidebar + section Share modal avec preview live + copy Markdown.
- **Repo bookmarks** — localStorage, liste des derniers repos scannés sur la landing.
- **Share card** — export PNG carte + stats, partage LinkedIn avec texte pré-rempli.
- **Compression client-side cache** — Web CompressionStream (gzip+base64) avant écriture `POST /api/stargazer-cache`. Résout les timeouts sur repos 50k+ étoiles.
- **Geocache pre-seeding** — ~51k entrées GeoNames (villes + pays). >99% hit rate sur scans réels.

---

## Quick wins (1-2h chacun)

- **Heatmap mode** — toggle dots ↔ densité de chaleur. Plus lisible sur les grands repos (50k+ stars). MapLibre supporte nativement le layer `heatmap`.
- **Multi-repo** — comparer deux repos sur la même carte (audiences qui se chevauchent). Star-history le fait pour les graphes, personne ne le fait géographiquement.
- **API publique GeoJSON** — `/api/geo/[owner]/[repo]` retourne le GeoJSON du scan. Pour chercheurs, journalistes, devs qui veulent builder dessus.

---

## Features moyen terme

- **Watch mode** — poll toutes les X minutes, affiche "+3 new stars in Paris" avec un badge qui pulse. Utile pour les lancements et les moments de traction.
- **Company breakdown** — on a déjà `company` dans les données. Top 20 companies qui star ton repo, avec logo si dispo via Clearbit. Très parlant pour le B2B.
- **Animated timelapse** — rejouer l'arrivée des stars dans le temps sur la carte. `StarEvent.starredAt` est déjà stocké. Satisfaisant à regarder, très partageable.
- **Vue historique géo** — stocker des snapshots géo par date (pays x date x count). Permet d'"animer" l'évolution géographique. Nécessite un scan périodique en background.

---

## Distribution / open source

- **Extension Chrome** — bouton sur chaque page GitHub `/repo`, ouvre le map sans quitter GitHub. C'est le vrai multiplicateur d'usage (cf. star-history.com).
- **Embeddable widget** — `<iframe src="starmapper.bruniaux.com/embed/owner/repo">` pour les READMEs. Carte interactive intégrable.
- **CLI** — `npx starmapper owner/repo` → génère un `map.html` standalone. Pour les devs qui veulent un artefact offline.

---

## Si monétisation un jour

- **Trending page** — "Ces repos recrutent des stars à Paris cette semaine." Trafic organique.
- **Alertes email** — "10 nouveaux stargazers cette semaine, 3 de chez Microsoft". Rétention + upsell naturel.

---

**Ordre de priorité suggéré** : Heatmap → Multi-repo → Extension Chrome → Watch mode.

Le heatmap est natif MapLibre (1h de travail max). Multi-repo différencie de star-history. L'extension multiplie la surface de découverte massivement.
