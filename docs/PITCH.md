# StarMapper : récap complet features + ce qui a évolué

## C'est quoi StarMapper ?

On donne un repo GitHub, on obtient une carte interactive de tous ses stargazers géolocalisés, avec clustering natif, stats par pays/ville/entreprise. Gratuit, open-source, pas de compte requis.
→ https://starmapper.bruniaux.com

---

## Pages disponibles aujourd'hui

- https://starmapper.bruniaux.com : landing page avec champ URL + tableau des repos déjà mappés
- https://starmapper.bruniaux.com/ruvnet/ruflo : carte des 45k stargazers de ruflo
- https://starmapper.bruniaux.com/explore : découvrir des devs par username, leaderboard, carte sticky

### /profile

- https://starmapper.bruniaux.com/profile/florianbruniaux : mon profil, mini-carte, stats, repos, nearby devs
- https://starmapper.bruniaux.com/profile/ruvnet : profil ruvnet, 174 repos, carte, langages, top repos

### Autres

- https://starmapper.bruniaux.com/devs : cartes de devs filtrées par langage
- https://starmapper.bruniaux.com/devs/atlas : carte choroplèthe, quel langage domine par pays ?
- https://starmapper.bruniaux.com/feed/florianbruniaux : ma page d'abonnement RSS
- https://starmapper.bruniaux.com/changelog : historique des versions

---

## Ce qui a évolué ces dernières semaines

### Profils développeurs (0.3.3 → 0.4.2)

La page profil est passée de "bio + followers" à un hub complet. Exemple concret avec https://starmapper.bruniaux.com/profile/ruvnet :

- **Section GitHub Repos** : ses top repos (ruflo, RuView, RuVector…) avec langages + étoiles, lien vers les 174 repos GitHub
- **Bouton "Map a repo"** à côté du badge "174 repos" : picker complet, searchable, triable Stars ou A–Z. Un clic et on arrive sur la carte StarMapper du repo (on a indexé ses 5 premiers ce soir : ruflo 45k, RuView 52k, RuVector 4k, agentic-flow 685, Bot-Generator-Bot 565)
- **Refresh** : met à jour location, followers, repos depuis GitHub et invalide le cache top repos pour repartir propre
- **Nearby developers** : les devs géolocalisés à moins de Xkm, avec pins sur la carte
- **Contact dropdown** : LinkedIn, email, GitHub, obfusqués contre le scraping

### Système d'abonnement RSS (0.4.0)

Les devs publient de courtes annonces (280 chars) sur leur profil via GitHub PAT. Mon feed en exemple :

- RSS 2.0 → https://starmapper.bruniaux.com/api/feed/florianbruniaux/rss
- JSON Feed 1.1 → https://starmapper.bruniaux.com/api/feed/florianbruniaux/json
- Page abonnement → https://starmapper.bruniaux.com/feed/florianbruniaux

Cache CDN 1h, `If-Modified-Since` / 304 supporté. Chaque hit RSS comptabilisé en analytics.

### Explore (continu)

https://starmapper.bruniaux.com/explore : leaderboard followers (top, power users, nearby), search par `@ruvnet` ou `ruvnet` (le `@` bloquait avant, fixé ce matin), carte sticky synchro avec les résultats.

### Organic Score (0.3.4)

Score 0–100 par repo estimant si les étoiles sont organiques ou "farmées", basé sur 3 signaux publics :

- Ratio forks/stars (40%)
- Ratio watchers/stars (5%)
- % de stargazers à zéro followers (55%)

Affiché dans la liste repos avec un modal de détail au clic. 92% de classification correcte sur le corpus de calibration.

### Notable stargazers + Geographic velocity (0.4.4)

- **Notable stargazers** : top-5 par followers affichés comme chips d'avatars dans la stats modal, visibles immédiatement à l'ouverture
- **Geographic velocity** (onglet "📈 Rising") : identifie les pays en accélération en comparant le taux 30j vs 31–90j avec labels `rising / new / stable / declining`

### Watch mode (0.4.5)

Polling GitHub toutes les 60s pendant un lancement. Badge pulsant affiché en temps réel (`+N ★ · India, Germany`). Arrêt automatique après 10 min d'inactivité.

### Chrome Extension (0.4.6)

Extension Manifest V3 installable depuis le Chrome Web Store. Injecte un bouton ★ Map sur chaque page de repo GitHub, popup toolbar avec le repo courant + historique des 5 derniers + champ de recherche, menu contextuel au clic droit sur les liens de repos.

### Language Atlas (0.3.0)

https://starmapper.bruniaux.com/devs/atlas : quel langage prédomine par pays, calculé sur 4M+ devs en DB, mis à jour quotidiennement.

---

## Stack

Next.js 16 (App Router) + TypeScript + MapLibre GL 5 + Prisma 7 + Neon Postgres + Jawg Maps, déployé sur Vercel, sponsorisé par Neon (100GB plan)
