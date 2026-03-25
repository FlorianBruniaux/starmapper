# StarMapper — Roadmap

## Quick wins (1-2h chacun)

- **Heatmap mode** — toggle dots ↔ densité de chaleur. Plus lisible sur les grands repos (50k+ stars). MapLibre supporte nativement le layer `heatmap`.
- **Multi-repo** — comparer deux repos sur la même carte (audiences qui se chevauchent). Star-history le fait pour les graphes, personne ne le fait géographiquement.
- **Share card** — screenshot PNG du map + stats (canvas API ou `html2canvas`). Parfait pour Twitter/LinkedIn : "here's where my open source users are".
- **Repo bookmarks** — localStorage, liste des derniers repos scannés sur la landing. Petite QoL mais très utilisée.

## Features moyen terme

- **Watch mode** — poll toutes les X minutes, affiche "+3 new stars in Paris" avec un badge qui pulse. Utile pour les lancements et les moments de traction.
- **Company breakdown** — on a déjà `company` dans les données. Top 20 companies qui star ton repo, avec logo si dispo via Clearbit. Très parlant pour le B2B.
- **Animated timelapse** — rejouer l'arrivée des stars dans le temps sur la carte. Satisfaisant à regarder, très partageable.
- **Follower network heatmap** — pas une carte géo, mais un graph : qui parmi tes stargazers se follow mutuellement ? Identifier les communautés (Rust devs, ML, etc.).

## Open source / distribution

- **Extension Chrome** — comme star-history : bouton sur chaque page GitHub `/repo`, ouvre le map sans quitter GitHub. C'est le vrai multiplicateur d'usage.
- **Embeddable badge/widget** — `<iframe src="starmapper.com/embed/owner/repo">` pour les READMEs. Comme les badges shields.io mais avec une carte.
- **CLI** — `npx starmapper owner/repo` → génère un `map.html` standalone. Pour les devs qui veulent un artefact offline.
- **OG image dynamique** — `/api/og?owner=&repo=` retourne une image PNG avec la carte + stats. Les liens Slack/Twitter auraient un aperçu automatique.

## Si monétisation un jour

- **Trending page** — comme la leaderboard de star-history mais géo. "Ces repos recrutent des stars à Paris cette semaine." Trafic organique.
- **Alertes email** — "10 nouveaux stargazers cette semaine, 3 de chez Microsoft". Rétention + upsell naturel.

---

**Recommandation** : dans l'ordre, Share card → Extension Chrome → Multi-repo → Watch mode.

Le share card crée de la viralité organique. L'extension multiplie la surface de découverte. Le multi-repo différencie de star-history. Le watch mode crée de la récurrence d'usage.
