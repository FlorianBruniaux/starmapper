# Competitive Research StarMapper

**Date** : 2026-03-24
**Source** : Analyse basée sur connaissance jusqu'en août 2025 (pas de recherche web live, outils bloqués)
**Scope** : Outils de visualisation/analytics GitHub stargazers

---

## 1. Landscape concurrentiel

| Outil | Features | Limites | Monétisation | Trafic estimé |
|-------|----------|---------|--------------|---------------|
| **star-history.com** | Courbe d'évolution des stars dans le temps, comparaison multi-repos, API publique, badge README | Pas de géo, pas de profil stargazer, timeline seulement | Freemium (open source, financement communauté) | Très fort (référence du genre) |
| **repobeats.axiom.co** | Insights repo : commits, PRs, contributors, localisation via embed badge README | Embed-first, pas de carte interactive, focus contributors pas stargazers | Freemium / Axiom cloud | Modéré |
| **ossinsight.io** | Analytics avancés GitHub (stars, forks, PRs, issues), comparaison repos, géo des contributors | Données contributors/PRs, pas spécifiquement stargazers géo, UI lourde | Gratuit (PingCAP-backed) | Fort |
| **gitstar-ranking.com** | Ranking repos et users par stars, leaderboard par pays | Ranking only, pas de carte, pas de détail stargazer | Publicité | Faible |
| **githubstats.com** | Stats basiques repo, followers, count | Très basique, pas de géo, pas de carte | - | Faible |
| **sourcegraph.com/code-insights** | Trends de code à l'échelle des repos | Enterprise, pas orienté stargazers | Enterprise payant | Niche enterprise |
| **next.ossinsight.io** | Profil GitHub, comparaison repos, heatmap géo contributors | Lent, UX complexe, géo sur contributors pas stargazers | Gratuit | Modéré |

### Ce que personne ne fait (ou fait mal)

- **Carte interactive des stargazers** (pas des contributors, pas des forks) : personne
- **Progression en temps réel** pendant le scan : personne
- **Comparaison overlay** deux repos sur la même carte : personne
- **Clustering par followers** (identifier les influencers dans la géo) : personne
- **Filtres audience** (par date de star, entreprise, followers) : personne

StarMapper est le seul outil avec une carte interactive centrée sur les **stargazers** (audience, pas contributeurs).

---

## 2. Opportunités différenciantes

### Tier 1 : Différenciation immédiate (déjà construite ou quasi)

**"Who stars your repo"** vs "who contributes", le pivot stargazer/audience est unique. Les maintainers veulent savoir d'où vient leur **audience**, pas leurs contributors (déjà visible sur GitHub).

**Le brief marketing à tester :** "star-history.com te dit *quand* ils ont starré. StarMapper te dit *d'où ils viennent*."

### Tier 2 : Features à construire pour creuser l'écart

| Feature | Pourquoi différenciante | Effort |
|---------|------------------------|--------|
| **Badge README** dynamique "🗺️ 42 countries" | Viralité inbound, chaque repo devient une pub StarMapper | 4-6h |
| **Embed widget** carte pour README/site | Dev advocates l'intègrent dans leur landing page | 1-2j |
| **API publique GeoJSON** | Chercheurs, journalistes, dev qui veulent builder dessus | 3-4h |
| **Export PNG** carte annotée | Partage Twitter/LinkedIn (image > lien) | Quasi fait |
| **"Audience report" PDF** | Pitch deck pour sponsors/entreprises | 1-2j |
| **Comparaison Venn** stargazers communs | "Mon repo a 23% d'overlap avec vercel/next.js" | 5-6h |

---

## 3. Comment les outils similaires ont grandi

### star-history.com
- **HackerNews** "Show HN" : a explosé via un seul post viral
- **GitHub README badges** : chaque projet qui l'utilise est une pub
- **Twitter dev community** : devs partagent leur courbe de stars (ego + curiosité)
- **Clé** : Outil simple, résultat visuel immédiatement partageable

### repobeats.axiom.co
- Distribution via Axiom (entreprise cloud observabilité), budget marketing pro
- **README embed** : la carte d'entrée (les maintainers l'ajoutent au README)
- Se retrouve dans les READMEs de gros projets → trafic inbound

### ossinsight.io
- **PingCAP-backed** : ressources enterprise, growth team dédiée
- Content marketing : analyses "Top 10 most starred repos 2024"
- Distribution LinkedIn/Twitter via insights périodiques

### Pattern commun : les 3 ont décollé via un **artefact partageable**
- star-history → la courbe (screenshot Twitter)
- repobeats → le badge README
- ossinsight → les rapports périodiques (infographies)

**StarMapper n'a pas encore son artefact viral.** La carte PNG est un candidat évident.

---

## 4. Features les plus demandées par les users (inféré des concurrents)

Sur la base des GitHub issues des outils similaires et des discussions HN/Reddit :

1. **"Show me where my users are"** : demande n°1 sur tous les outils de stats GitHub
2. **"Compare with [concurrentrepo]"** : très demandé sur star-history
3. **"Export data as CSV"** : demande récurrente (StarMapper l'a déjà)
4. **"Badge for my README"** : star-history en a fait son vecteur de croissance principal
5. **"Historical view"** : voir l'évolution géo dans le temps (actuellement impossible pour tous)
6. **"Email list of my stargazers"** : demandé mais sensible (privacy)
7. **"Who are the influencers in my stars?"** : "les gros followers qui m'ont starré"

StarMapper couvre 1, 2, 3, 4 ✅, 7 déjà. Il manque la vue historique géo (5).

---

## 5. Recommandations prioritaires

### #1 : Badge README dynamique ✅ FAIT

```
[![StarMapper](https://starmapper.bruniaux.com/api/badge/vercel/next.js)](https://starmapper.bruniaux.com/vercel/next.js)
```

Affiche : `mapped • XX countries • YYY stars`

**Implémenté** : Route `/api/badge/[owner]/[repo]` (SVG shields-style, cache CDN 6h). Bouton "Badge" dans la sidebar de la page map + section dans le Share modal. Markdown copiable en 1 clic.

### #2 : "Show HN" / Product Hunt au bon moment

**Timing** : Lancer quand le badge est prêt + PNG export propre = deux artefacts partageables déjà en place.

**Angle HN** : "I built a tool to see where in the world your GitHub repo is loved"

**Ne pas lancer** sans le badge (sinon pas de rétention virale post-launch).

### #3 : Contenu Twitter/LinkedIn régulier

Analyser les gros repos open source chaque semaine et partager la carte :
- "Where are React's 226k stargazers? 🗺️"
- "Rust vs Python stargazers geography, who's more global?"

**Distribution** : Twitter dev community, LinkedIn dev advocates, Reddit r/programming.

### #4 : Embed widget

Iframe ou `<script>` qui permet d'intégrer la carte dans n'importe quel site/doc. Devs advocates et project pages veulent ça.

### #5 : Vue historique géo (différenciateur fort, effort moyen)

Stocker en DB les snapshots géo par date (pays x date x count). Permettre d'"animer" la carte dans le temps.

**Blockers** : nécessite stockage Neon plus conséquent + job de scan périodique. À faire en Phase 2.

---

## 6. Positionnement recommandé

**Against star-history.com** : "Ils te montrent quand. Toi tu montres où."

**Against ossinsight/repobeats** : "Eux analysent les contributors (qui code). Toi l'audience (qui s'intéresse)."

**Tagline** : "See where in the world your GitHub repo is loved." ← déjà bien, garder.

**Persona cible prioritaire** : Le dev/indie hacker qui maintient un projet open source et veut comprendre son audience pour prioriser sa communication, ses traductions, ses partnerships. Il twittere ses métriques, il lit HN, il ajoute des badges à ses READMEs.

---

*Analyse figée août 2025, mise à jour statut features 2026-03-27*
