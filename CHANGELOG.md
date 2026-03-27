# Changelog — StarMapper

Historique des changements significatifs du projet.

## Format

- **[Next Release]** : changements en cours, pas encore versionnés
- Sections : Nouvelles fonctionnalités, Performances, Corrections, Technique, Documentation
- Versioning : Semantic Versioning (MAJOR.MINOR.PATCH)

---

## [Next Release]

### Nouvelles fonctionnalités

- **Badge button sidebar** : Bouton "Badge" dans la sidebar de la page map (entre History et Share) → mini-modal dédié avec preview live du badge, code Markdown sélectionnable, et bouton "Copy Markdown" avec feedback.
- **Badge dans Share modal** : Section "README badge" en bas du panneau Share — même preview et copy que le modal dédié.
- **Footer ecosystem** : Footer sur la landing page avec liens projets (Claude Code Guide, Cowork, ccboard, cc-copilot-bridge, RTK), liens auteur (Blog, Dev With AI, GitHub), et "Made by Florian Bruniaux".
- **Pagination community maps** : Le tableau des repos sur la landing page est désormais paginé (20 lignes/page) avec boutons Prev/Next. Limite API relevée de 50 à 200 repos.

### Performances

- **Compression client-side gzip avant écriture cache** : Les données de scan sont désormais compressées côté client (Web CompressionStream API, gzip+base64) avant envoi à `POST /api/stargazer-cache`. Résout un bug silencieux : pour les repos >~15k étoiles, le payload JSON brut (~15MB) dépassait la limite Vercel de 4.5MB → le cache n'était jamais écrit → les visiteurs suivants devaient rescanner. La compression réduit le payload à ~800KB.
- **Geocache GeoNames warm-up** : Pre-seeding de la geocache avec ~51k entrées issues de GeoNames (villes pop >15k + pays + codes ISO2/ISO3). Hit rate mesuré >99% sur les scans réels — les appels aux APIs de géocodage (Jawg, Geoapify, Nominatim) sont quasi-éliminés pour les locations communes.
- **Nettoyage geocache** : Suppression de 36 entrées garbage (#hashtags, $variables shell, `[object Object]`, XSS artifacts, templates Jinja). Ajout du script `scripts/clean-geocache-garbage.ts`.

### Corrections

- **React hydration fix** : Accès à `localStorage` pendant le render SSR causait React error #418 + crash `y.map is not a function`. Fix : état `hasToken` initialisé à `false` (SSR-safe), synchronisé via `useEffect`.
- **Race condition pre-scan modal** : La modale de pré-scan apparaissait brièvement même pour les repos déjà indexés. Fix : état `cacheCheckDone`, la modale est conditionnée à la complétion de la vérification DB.
- **Geocoder** : Filtre `isGeocodeableLocation` étendu aux préfixes `#$<>[{\"!` — bloque hashtags, variables shell, code artifacts avant tout appel API ou écriture en cache.

### Technique

- **Scripts one-shot** : `scripts/seed-geocache-geonames.ts` (idempotent, `--dry-run` disponible) et `scripts/clean-geocache-garbage.ts`. Commandes npm : `pnpm seed:geonames`, `pnpm seed:geonames:dry`.
- **Dépendance** : `tsx` ajouté en devDependency pour l'exécution des scripts TypeScript.

---

## [0.1.0] - 2026-03-26

Version initiale publique.

### Nouvelles fonctionnalités

- **Dark / light mode** : Toggle dans le header avec migration complète des tokens CSS.
- **Sidebar mobile repliable** : La sidebar gauche sur la page map est collapsible sur mobile, avec bouton de fermeture visible.
- **Landing page redesign** : Layout deux colonnes (form + community maps table), feature highlights colorés, FAQ.
- **Community maps table** : Tableau des repos déjà scannés sur la landing, trié par date de scan, colonnes Stars / Mapped% / Countries / Last scan.
- **Filtre followers** : Curseur pour filtrer les stargazers par nombre de followers depuis la barre de contrôle de la carte.
- **Filtres pays et ville** : Combobox de filtrage dans le tableau des stargazers.
- **Partage LinkedIn** : Panel de pré-partage avec texte éditable et copie dans le presse-papier.
- **Badge SVG** : `/api/badge/[owner]/[repo]` — shield avec mapped count et country count, cache CDN 6h.
- **Export image / Markdown** : Depuis les stats du scan.
- **SEO / GEO** : `robots.txt`, `sitemap.xml`, FAQ structurée, Open Graph metadata.
- **Explore page** : `/explore` listant les repos mappés avec stats.

### Performances

- **Stargazer cache** : Cache partagé des scans complets (`stargazer_cache` table) — rechargement instantané pour les visiteurs suivants sur un même repo. Limite : 100k stars.
- **Compression gzip** : Les données du cache stargazer sont compressées (gzip+base64), réduisant la taille des payloads de ~70%.
- **Skip users en cache** : Le chunk endpoint ne ré-écrit pas en DB les users déjà présents et inchangés.
- **Geocache "not found"** : Les locations qui ne geocodent pas sont cachées avec `lat=null/lng=null` — évite les appels API répétés pour le même garbage.
- **Géocodage Geoapify** : Ajout de Geoapify comme fallback 2 (entre Jawg et Nominatim), avec circuit breaker.
- **Filtre locations invalides** : `isGeocodeableLocation()` filtre TLDs, préfixes téléphoniques, URLs, valeurs placeholder avant tout appel.

### Architecture

- **Chunk loop client-side** : Le browser orchestre les appels `POST /api/chunk` (100 users/appel) pour rester sous le timeout Vercel de 10s.
- **Geocache partagée** : Table `geocache` Neon partagée entre tous les repos — une location géocodée une fois bénéficie à tous les scans futurs.
- **3-tier geocoding** : Jawg (primary, circuit breaker) → Geoapify (fallback 1, circuit breaker) → Nominatim (fallback final, 1100ms/req).
- **User-level cache** : `github_user` + `star_event` tables pour tracker les utilisateurs et leurs repos au niveau utilisateur.
- **Token modal** : L'utilisateur peut fournir son propre GitHub PAT pour les repos >6k stars (limite unauthenticated).
