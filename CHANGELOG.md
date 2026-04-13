# Changelog — StarMapper

Historique des changements significatifs du projet.
Versioning : Semantic Versioning (MAJOR.MINOR.PATCH)

---

## [0.3.1] — 2026-04-13

### Corrections

- **Fix auth Jawg** — `callJawg()` dans `geocoder.ts` envoyait le token uniquement via header `x-api-key`. Ajout du query param `access-token` requis par l'endpoint dédié `starmapper.jawg.io`. Sans ce param, les requêtes Jawg retournaient 401 silencieusement.
- **Fix label geocode explore** — `/api/explore/geocode` reconstruisait le label manuellement avec `p.city` (champ inexistant dans le modèle Jawg Places). Remplacé par `feature.properties.label` que Jawg fournit nativement.
- **Fix tests geocoder** — `geocoder.test.ts` stubbait `JAWGMAP_ACCESS_TOKEN` alors que le code lit `JAWG_TOKEN_HEADER`. 7 tests pré-existants échouaient silencieusement. Corrigé.
- **Docs** — Remplacement de toutes les occurrences de "Pelias" par "Jawg Places" dans `README.md` et `docs/ARCHITECTURE.md`. Jawg Places est basé sur Pelias mais la marque correcte est Jawg Places.

### Technique

- **Consolidation `fetchAndPatchStyle`** — La fonction existait en double : une version inline dans `stargazer-map.tsx` (30 lignes, sans cache) et une version dans `lib/map-style.ts` (avec cache). `lib/map-style.ts` est désormais la source unique. La fonction accepte un paramètre `projection` (`"mercator"` | `"globe"`, défaut `"mercator"`) avec clé de cache composite `${url}#${projection}` pour éviter les collisions globe/mercator.
- **Suppression patches style obsolètes** — `lang=en` retiré des URLs de style dans `theme.ts` et `stargazer-map.tsx` (Jawg gère la langue nativement). Patch glyphs URL retiré (`lib/map-style.ts`, `stargazer-map.tsx`). Remplacement `name:fr → name:en` retiré (`map-style.ts`, `stargazer-map.tsx`).
- **Migration `batch-scan.ts`** — Endpoint geocodage migré de `api.jawg.io` vers `starmapper.jawg.io` (endpoint dédié StarMapper). Token migré de `JAWGMAP_ACCESS_TOKEN` vers `JAWG_TOKEN_HEADER`. Ajout du header `x-api-key`.
- **Refactor CLI scripts** — Les 10 scripts dans `scripts/` utilisent désormais `node:util parseArgs` avec `strict: true` au lieu des patterns ad-hoc `process.argv.includes` / `getArg`. `parseArgs` est natif Node 18+, sans dépendance.

---

## [0.3.0] — 2026-04-10

### Nouvelles fonctionnalités

- **Language Atlas** — Page `/devs/atlas` : carte choroplèthe mondiale affichant le langage le plus populaire par pays, calculé sur les repos étoilés et contribués. Détail par pays au clic (langage dominant, %, nombre de devs). Bandeau "Early preview" le temps du backfill.
- **Dev Maps par langage** — Pages `/devs` et `/devs/[language]` : carte des développeurs filtrée par langage, avec combobox de sélection.
- **Backfill langages** — Script `backfill-languages.ts` pour alimenter le champ `languages[]` sur `github_user`. Mode `--from-cache` : dérive les langages depuis `star_event + badge_cache` sans appel GitHub (1,23M users en quelques secondes). Mode API : parallélisable via `--token-index`.
- **Materialized view `country_language_stats_mv`** — Agrégation (pays × langage) pour l'Atlas. Créée/rafraîchie automatiquement par `pnpm db:sync` et le cron admin quotidien.

### Performances

- **Backfill 3× plus rapide** — `maxRepositories: 30 → 10` (moins de points GraphQL consommés), batch par défaut `10 → 50`, bulk UPDATE via `unnest()` (1 requête SQL au lieu de N individuelles).

### Corrections

- **db:sync** — `github_user` passait de `DO NOTHING` à `DO UPDATE` : les colonnes `languages` et `languagesFetchedAt` n'étaient jamais poussées vers Neon. Corrigé.
- **db:sync** — Création automatique de `country_language_stats_mv` sur Neon lors du sync si elle n'existe pas encore.

### Technique

- **`LANGUAGE_COLORS`** — Map de 24 langages vers des couleurs distinctives dans `src/lib/language-colors.ts`.
- **`LanguageChoropleth`** — Composant MapLibre choroplèthe (dynamic import `ssr: false`).
- **Copy Atlas** — Wording "gravitate toward" et "favor" plutôt que "use" / "dominant" (données = affinité, pas pratique certifiée).

---

## [0.2.0] — 2026-03-31

### Sécurité

- **Token HMAC session** — Cookie `sm-token` (HttpOnly + SameSite=Strict), signé HMAC-SHA256 via Web Crypto API (Edge-compatible). Émis à chaque page load, vérifié sur tous les endpoints strict-get. Nécessite `SM_TOKEN_SECRET`. Bloque le scraping par Referer forgé même avec un cookie valide.
- **Rate limiting distribué** — Remplacement des compteurs en mémoire (par-instance Vercel) par Upstash Redis sliding windows. Les limites survivent au scaling serverless. Tiers : chunk 100/min, strict-get 30/min, moderate-get 60/min, admin 10/min, stargazer-cache-get 3/min (dédié).
- **Cloudflare IP** — Middleware lit `CF-Connecting-IP` avant `x-forwarded-for` : les limites par-IP utilisent la vraie IP visiteur derrière Cloudflare (avant : ~15 IPs fixes Cloudflare vues par Upstash).
- **Tier dédié stargazer-cache** — GET `/api/stargazer-cache/*` obtient son propre limiter 3 req/min au lieu de partager le pool strict-get 30/min. Un seul hit cache retourne jusqu'à 50k users.
- **Promotion de routes** — `/api/repos` et `/api/explore/global-map` passent de moderate-get à strict-get (Referer + HMAC). Les deux étaient des points d'entrée d'énumération sans validation d'origine.
- **Caps de pagination** — `explore/top` et `explore/power` : `MAX_SKIP=500`. `explore/top` : filtre minimum 2 caractères pour bloquer l'énumération cross-product par caractère unique.
- **Vérification Referer** sur tous les endpoints strict-get (stargazer-cache, stats, explore/top|power|user-repos|global-map, repos, profile).
- **Origin check** — Les endpoints POST rejettent les origines non-localhost quand `NEXT_PUBLIC_APP_URL` est absent (avant : check silencieusement ignoré).
- **Protection écriture stargazer-cache** — POST valide : fraîcheur du timestamp (±5min), plausibilité (totalCount dans ±50% de la valeur existante), maximum 100k users.
- **Fix XSS** — `stargazer-map.tsx` popup : remplacement du template literal `innerHTML` par `createTextNode` + `createElement`. Élimine le vecteur XSS sur le champ `topLogin`.
- **CSP renforcée** — `unsafe-eval` retiré de `script-src` en production (dev uniquement). `Strict-Transport-Security` ajouté (max-age=2y). `X-Robots-Tag: noindex, nofollow` sur toutes les routes `/api/*`.
- **Validation input** — Whitelist de caractères unicode sur les params `country`/`search` dans `explore/top`.
- **Sanitization erreurs** — `sanitizeError`/`logError` dans `api-helpers` retire les URLs Postgres, Bearer tokens et GitHub PATs des logs serveur avant qu'ils atteignent le dashboard Vercel.
- **Suppression side-effect GET** — `explore/user-repos` n'effectue plus d'écriture DB sur GET.
- **Réduction précision lat/lng** — Les réponses API arrondissent les coordonnées à 2 décimales (~1.1km). Précision complète conservée en DB.
- **Semgrep SAST CI** — Workflow sur push/PR vers main et hebdomadaire (dimanche 02:00 UTC). Couvre typescript, owasp-top-ten, secrets, nodejs.

### Nouvelles fonctionnalités

- **Find me** — Username GitHub sauvegardé en localStorage. Premier usage : prompt inline. Visites suivantes : un clic pour voler vers son propre pin sur la carte.
- **Badge button sidebar** — Bouton "Badge" dans la sidebar (entre History et Share) → mini-modal avec preview live, code Markdown sélectionnable, bouton "Copy" avec feedback.
- **Badge dans Share modal** — Section "README badge" en bas du panneau Share.
- **Explore page 2 colonnes** — Leaderboard tabs (gauche) + carte sticky (droite), toujours visible. Largeur max portée à `max-w-7xl`.
- **Recherche + tri liste repos owner** — Filtre par nom/description, 4 modes de tri (stars desc/asc, A–Z, Z–A).
- **Stats panel : tri publicRepos** — Top users triables par followers ou dépôts publics. Export CSV derrière flag env.
- **Token requis pour rescan** — Rescan complet et delta refresh nécessitent désormais un token GitHub (icône verrou affiché).
- **Footer landing** — Boutons pill "by Florian Bruniaux" et "Follow" avec liens portfolio/GitHub.
- **Pagination community maps** — Tableau paginé (20 lignes/page) avec boutons Prev/Next. Limite API portée de 50 à 200 repos.

### Performances

- **Compression gzip client-side** — Données de scan compressées côté client (Web CompressionStream, gzip+base64) avant `POST /api/stargazer-cache`. Résout la perte silencieuse du cache sur les repos >~15k étoiles (payload brut ~15MB > limite Vercel 4.5MB). Payload réduit à ~800KB.
- **Geocache GeoNames** — Pre-seeding de ~51k entrées (villes pop >15k + pays + codes ISO2/ISO3). Hit rate >99% sur les scans réels.
- **Nettoyage geocache** — 36 entrées garbage supprimées (#hashtags, $variables shell, `[object Object]`, artifacts XSS, templates Jinja).
- **DB portabilité** — Adaptateur conditionnel dans `db.ts` : `DATABASE_DRIVER=standard` → `@prisma/adapter-pg` (Docker, Railway, Supabase) ; défaut → `@prisma/adapter-neon`. L'auto-hébergement sans Neon fonctionne.
- **DB optimisations** — Index ajoutés sur les chemins de requête chauds, caps de résultats (`take: 10_000`), health guard TTL-aware.

### Corrections

- **Bug antimeridian** — La Russie et autres pays croisant le 180° causaient un triangle artifact sur la carte choroplèthe. Fix : normalisation des rings polygone pour qu'aucun sommet adjacent ne diffère de plus de 180° en longitude.
- **MapLibre Web Worker CSP** — Ajout de `worker-src blob:` (bloquait le web worker MapLibre → carte blanche sur certaines configs).
- **React hydration** — Accès à `localStorage` pendant le render SSR causait React error #418. Fix : état initialisé SSR-safe, synchronisé via `useEffect`.
- **Race condition pre-scan modal** — La modale de pré-scan apparaissait brièvement sur les repos déjà indexés. Fix : état `cacheCheckDone`.
- **Geocoder** — Filtre `isGeocodeableLocation` étendu aux préfixes `#$<>[{"!`.

### Technique

- **Licence AGPL-3.0-only** — Headers SPDX sur les 50 fichiers source, fichier NOTICE.
- **Refactoring API** — Libs partagées : `api-validation.ts`, `api-helpers.ts`, `compression.ts`, `compress-client.ts`. Remplacement de 10 patterns dupliqués sur 15 route handlers.
- **Conventions code** — Routes API converties en const arrow functions. `interface` → `type`. `import type` pour les imports type-only.
- **Scripts** — `batch-scan.ts` : écritures FLUSH_EVERY incrémentales, cache géocodage session-level, meilleure récupération sur erreur.
- **Dependabot** — Mises à jour hebdomadaires des dépendances sur main.
- **Prisma 7.5 → 7.6** — Corrige 12 vulnérabilités (3 high, 8 moderate, 1 low) dans la chaîne dev transitive.

---

## [0.1.0] — 2026-03-26

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
