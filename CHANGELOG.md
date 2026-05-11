# Changelog — StarMapper

Historique des changements significatifs du projet.
Versioning : Semantic Versioning (MAJOR.MINOR.PATCH)

---

## [0.4.5] — 2026-05-11

### Features

- **Watch mode** — Bouton "Watch" dans le Dock (visible pour les repos scannés avec timestamps). Active un polling GitHub toutes les 60s : compare les stargazers récents au timestamp de démarrage, détecte les nouvelles étoiles sans rescanner. Affichage : point vert pulsant + `+N ★ · India, Germany` en temps réel. S'arrête automatiquement après 10 min sans nouvelle étoile. Endpoint `GET /api/watch/[owner]/[repo]?since=<ISO>` : GitHub REST + lookup `countryNormalized` depuis `github_user` (aucun appel Nominatim). Aucune écriture DB, `Cache-Control: no-store`.

---

## [0.4.4] — 2026-05-11

### Features

- **Notable stargazers row** — Le modal Stats affiche maintenant les 5 meilleurs stargazers par followers sous forme de chips d'avatars, visibles dès l'ouverture sans changer d'onglet. Chaque chip montre l'avatar, le login et le nombre de followers. Un lien "Top N →" bascule vers l'onglet Top Stars complet. Données disponibles immédiatement depuis les points scannés en mémoire (aucun appel API supplémentaire).
- **Geographic velocity ("📈 Rising")** — Nouvel onglet dans le modal Stats qui révèle quels pays découvrent le repo en ce moment. Compare le rythme quotidien des 30 derniers jours au rythme historique des jours 31–90. Quatre statuts : `rising` (×1.5+), `new` (aucun historique), `stable`, `declining` (≤0.5). Chargement paresseux : la requête ne part que lorsque l'onglet est ouvert, une seule fois par session. Endpoint `GET /api/stats/[owner]/[repo]/geo-velocity`, requête SQL avec `COUNT(*) FILTER`, cache CDN 5 min.

---

## [0.4.3] — 2026-05-11

### Features

- **Deep link sharing** — The Share modal now shows a "Current view" section when filters are active (country, city, company, followers, date, tier, view mode). The filtered URL is copy-able in one click and encodes all active filters as query params. Loading a shared URL restores the filter state and shows a dismissible "Shared view" overlay listing the active filters.
- **Velocity indicator** — The Stats modal summary row shows `+N/mo` in green under the star count, computed from `starredAt` already in memory after a scan. Only appears when the data is present (recent scans with timestamps); silently absent for old caches.

### Internal

- **Zod body validation on all POST routes** — All 7 POST routes migrated to a `defineRoute(schema, handler)` wrapper. New `src/schemas/` directory holds typed Zod v4 schemas for each route (`track`, `vitals`, `recalculate-location`, `badge-update`, `chunk`, `news`, `stargazer-cache`). Per-field error codes are declared directly in schemas; `defineRoute` surfaces `issues[0].message` verbatim so every existing error contract is preserved unchanged. Manual `typeof` / regex validation chains removed from all route handlers. `getIP` exported from `api-helpers` to replace a duplicate helper in the chunk route.

---

## [0.4.2] — 2026-05-08

### Features

- **GitHub Repos section on profile pages** — `/profile/[login]` now shows the cached top repos grid (up to 8, from `topRepos` in DB). Count badge reflects the real `publicRepos` value from GitHub, not the cached repo list length.
- **Map a repo modal** — "Map a repo" button next to the repos count badge opens a full-repo picker: fetches all public repos from GitHub (up to 500), searchable by name/description, sortable by Stars or A–Z. Clicking any repo navigates directly to its StarMapper map.

### Bug Fixes

- **Explore — `@username` search** — Searching with a leading `@` (e.g. `@ruvnet`) now works the same as without. The prefix is stripped before debouncing to the search state.
- **Profile — stale `topRepos` after Refresh** — After a manual Refresh, `topReposFetchedAt` is reset so the next profile load re-fetches top repos from GitHub instead of serving the outdated cache.

---

## [0.4.1] — 2026-05-05

### Features

- **Page `/changelog`** — Timeline versionnée servie depuis `CHANGELOG.md` au build. Server Component avec rendu inline bold+code sans dépendance markdown externe. Lien ajouté dans le footer et dans la bannière d'annonce.

### Performance

- **Explore — timeout O(N) sur les bounding boxes denses** — Les zones à haute densité (Singapore, etc.) pouvaient renvoyer 12k+ utilisateurs dans la bounding box. Le JOIN sur `user_repo_count_mv` sur 12k lignes via Neon dépassait le statement timeout de 10s. Résolu en remontant le filtre `lat IS NOT NULL` avant le JOIN et en limitant les candidats à 500 avant enrichissement.

### Bug Fixes

- **FollowButton — dropdown plus large** — Largeur passée à `w-96` avec padding augmenté pour éviter le wrapping des URLs RSS/JSON.
- **FollowButton — mode minimal sur la page subscribe** — Sur `/feed/[login]`, le dropdown était redondant (URLs déjà affichées). Prop `minimal` ajoutée : toggle direct sans dropdown.

---

## [0.4.0] — 2026-04-24

### Features

- **News & Annonces sur les profils** — Les développeurs peuvent publier de courtes annonces (280 chars max, lien optionnel) directement sur leur profil StarMapper. Authentification via GitHub PAT — le même token que celui utilisé pour scanner des repos. Cooldown de 24h glissantes par auteur (soft-delete inclus dans le cooldown, anti-contournement). Composant `NewsTimeline` intégré sur `/profile/[login]` avec skeleton loader, bouton "Publish" conditionnel (visible uniquement si le token stocké correspond au login de la page).
- **RSS 2.0 + JSON Feed 1.1 par développeur** — Chaque profil expose deux feeds abonnables : `GET /api/feed/[login]/rss` (RSS 2.0 avec `<atom:link>`, `If-Modified-Since`, réponse 304) et `GET /api/feed/[login]/json` (JSON Feed 1.1). Cachés 1h CDN. Subscribe link (icône RSS + "Subscribe") affiché en tête de la section News sur le profil.
- **Page `/feed/[login]`** — Page dédiée aux abonnements : hero avec avatar + identité, subscribe card avec URLs RSS/JSON copiables, liste complète des annonces, lien de retour vers le profil carte. Accessible via le lien "Subscribe" sur le profil ou "View all" sur la timeline.
- **`NewsPublishModal`** — Modal de publication avec compteur de chars (280), champ URL optionnel, affichage des URLs de feed copiables post-publication. Gestion des erreurs : cooldown restant affiché en h/min, token invalide signalé clairement.
- **`verifyPat()` + cache Upstash** — `src/lib/github-auth.ts` : vérification d'un GitHub PAT via l'API REST (`/user`), résultat mis en cache dans Upstash Redis 5 min. Clé de cache = préfixe SHA-256 du PAT (jamais le token brut). Fallback gracieux si Redis indisponible.
- **Tracking abonnés RSS** — Chaque hit sur `/api/feed/[login]/rss` est comptabilisé dans `page_view` (type `"feed_rss"`, slug = login). Consultable via `pnpm stats:views`.

### Security

- **CSP nonces dynamiques** — Le middleware génère un nonce par requête (`crypto.randomUUID()`), le passe via le header `x-nonce`, et construit un `Content-Security-Policy` avec `'nonce-{n}'` — supprime `unsafe-inline`. `layout.tsx` lit le nonce et l'applique aux deux scripts inline. La directive CSP statique dans `next.config.ts` est supprimée (gérée dynamiquement).
- **HMAC cookie sur les routes POST** — Quand `SM_TOKEN_SECRET` est défini, le middleware vérifie un cookie de session HMAC sur toutes les routes POST. Les appels curl/server-side sans cookie sont bloqués ; les navigateurs envoient automatiquement le cookie HttpOnly.
- **Rate limit fail-closed** — `rateLimit()` en mode `failClosed=true` sur toutes les routes POST : si Redis est indisponible, retourne 503 au lieu de laisser passer silencieusement.
- **Cache PAT signé HMAC** — Les entrées `pat:*` dans Upstash sont signées via HMAC-SHA256 (`CACHE_SIGN_SECRET`). Un attaquant avec accès Redis ne peut pas forger de valeur sans la clé de signature. Fallback en plain string si `CACHE_SIGN_SECRET` absent.
- **TTL cache PAT réduit** — 300s → 60s : fenêtre de révocation d'un token réduite de 5 min à 1 min.
- **Redis nx-lock sur publish news** — Lock `SET NX` avant le check cooldown + création pour prévenir le TOCTOU (deux requêtes concurrentes passant le cooldown simultanément → doublon).

### Bug Fixes

- **TokenModal — username non résolu** — Le modal ne stockait que le token, jamais le username. Sur les pages autres que la carte (ex. `/profile/[login]`), `getStoredUsername()` retournait `""`, ce qui faisait passer `isOwner` à `false` et masquait le bouton "Publish" même pour le propriétaire du profil. `handleSave` résout désormais le login via `GET /api.github.com/user` et le stocke. "Verifying…" pendant la vérification, `handleRemove` efface également le username.
- **Middleware** — `POST_LIMITERS` utilisait une comparaison exacte sur les routes POST, manquant les routes avec segments dynamiques (ex. `/api/news/item/123`). Remplacé par des regex.
- **Cooldown news** — Les posts soft-deleted n'étaient pas comptés dans la fenêtre de 24h, ce qui permettait publish → delete → re-publish immédiat. Le cooldown inclut désormais les entrées supprimées.
- **Organic score** — L'endpoint `/api/organic-score/refresh` n'avait pas de guard server-side sur le feature flag. Guard ajouté : retourne 404 si `NEXT_PUBLIC_ORGANIC_SCORE_ENABLED !== "true"`.
- **Web Vitals** — Whitelist des noms de métriques valides (`CLS`, `FID`, `FCP`, `LCP`, `TTFB`, `INP`) + validation que les champs numériques sont bien des nombres. Évite les injections de données arbitraires dans la table `web_vitals`.

### Internal

- **`feed-builders.ts`** — Deux fonctions pures : `buildRss20()` (XML RSS 2.0, CDATA correct, `]]>` splitté en deux sections CDATA) et `buildJsonFeed()` (objet JSON Feed 1.1). Logique de construction découplée des routes pour testabilité.
- **`isValidLogin()` / `normalizeLogin()`** — Helpers centralisés dans `github-auth.ts`, réutilisés par toutes les routes news et feed.

---

## [0.3.5] — 2026-04-24

### Features

- **Announcement banner** — Bandeau dismissible en haut de la home pour annoncer les nouveautés. Dismissal stocké en localStorage par `BANNER_ID` ; bumper l'ID pour le faire réapparaître sur la prochaine annonce. Header home passé en `sticky` pour s'empiler naturellement sous le bandeau.
- **Hook banner-reminder** — `PostToolUse` hook qui détecte la création d'une nouvelle `page.tsx` ou `route.ts` et rappelle de mettre à jour `AnnouncementBanner`.

### Bug Fixes

- **Bouton Map explore** — Le bouton "Map" était caché (`opacity-0`) pour les users *avec* coordonnées, et visible (gris) pour ceux *sans*. Inversé : bouton toujours visible et cliquable pour les users géolocalisés, `invisible` (espace préservé) pour les autres.
- **Compteur Countries = 0** — `country_stats_mv` créée à vide (aucun `countryNormalized` au moment de la création), puis jamais rafraîchie après le backfill. Ajout des commandes `create:country-stats-mv` / `create:country-stats-mv:prod` pour créer et rafraîchir la MV.
- **Tooltips colonnes repos** — Les tooltips des headers de colonnes sortables étaient cachés derrière la barre de recherche. Positionnement corrigé.

### Internal

- **Script `starmapper-update.sh`** — Meta-script qui chaîne tous les backfills en séquence (`repo-metrics` + `repo-languages`). Commandes `update:prod`, `update:local`, `update:local:force`.
- **Scripts `backfill:repo-metrics:local` / `:local:force`** — Variantes locales (Docker) du backfill repo-metrics avec `DATABASE_DRIVER=standard`.

---

## [0.3.4] — 2026-04-22

### Features

- **Organic Score** — Score de popularité "organique" par repo (0–100), calculé à partir de signaux d'activité indépendants des stars : forks, zero-dependency forks, watchers, issues ouvertes, PRs ouvertes. Pondération : ZF 55% / forks 40% / watchers 5%. Score affiché via `OrganicScorePill` récupéré indépendamment du reste de la page.
- **Colonne organic score dans repos list** — Colonne sortable sur la landing, colorée par tier (🟢 great / 🟡 good / 🟠 moderate / ⚫ low), avec modal de détail au clic (breakdown des signaux + comparaison StarScout).
- **`openPRsCount` dans `BadgeCache`** — Séparation issues / PRs dans le modèle (avant : champ `openIssuesCount` mixte). Modal organic score affiche les deux badges séparément et cliquables (liens vers GitHub).
- **Page calibration organic score** — `/api/admin/calibrate-organic-score` — page de debug pour comparer les scores sur un échantillon réel, accessible localement.

### Bug Fixes

- **Timeout Neon** — `stats/[owner]/[repo]` levait une timeout Neon sur les grosses tables. Fallback gracieux : retourne les données partielles disponibles sans planter.
- **Backfill prod** — `backfill-repo-metrics.ts` utilisait `DATABASE_URL_LOCAL` au lieu de `DATABASE_URL` sur les commandes `:prod`. Corrigé + `NEXT_PUBLIC_ORGANIC_SCORE_ENABLED=true` forcé.

### Internal

- **Rééquilibrages poids** — Deux passes de calibration : watcher 10%→5%, fork 70%→40%, zero-fork 25%→55%. Résultats plus discriminants sur les repos réels.
- **Docs méthodologie** — `docs/organic-score.md` : comparaison StarScout vs StarMapper, formule de normalisation, limites connues.

---

## [0.3.3] — 2026-04-16

### Features

- **Page profil développeur** — `/profile/[login]` : layout deux colonnes (panneau scrollable 2/3 + carte sticky 1/3). Données : bio, followers, repos, langages, star events trackés, contribution par pays. Profil partiel si user absent de la DB (refresh déclenché automatiquement).
- **Entrées profil** — Clic sur avatar/login dans les popups carte, dans `explore/top`, `explore/power`, `explore/nearby`. Bouton "View StarMapper profile →" dans le popup stargazer.
- **Profil : nearby developers** — Section "Nearby developers" sur la page profil : liste + pins sur la carte des devs géolocalisés à moins de Xkm.
- **Profil : contact dropdown** — Menu déroulant avec liens LinkedIn (obfusqué), email (obfusqué), GitHub — protégés contre le scraping.
- **Profil : view tracking** — `POST /api/track` déclenché au chargement ; compteur de vues journalier par profil dans `page_view`.
- **GeoJSON API gated** — `GET /api/geo/[owner]/[repo]` : endpoint agrégé retournant les points GeoJSON d'un scan, protégé par API key HMAC. Utilisable par des outils tiers.
- **Timelapse** — Rejouer l'historique d'acquisition d'étoiles par mois/semaine avec sélecteur de vitesse. Basé sur `star_event.starredAt`.

### Performance

- **Core Web Vitals audit** — Multiple passes : `startTransition` autour des dispatches chunk loop, `useDeferredValue` sur le filtre stargazers, `useCallback` sur les handlers carte, gating des memos coûteux, lazy-load `TokenModal` + `SponsorsBlock`, `width/height` sur les avatars (CLS).
- **ETag + CDN** — Two-step ETag sur `stargazer-cache`, TTL CDN optimisé, index login superflu supprimé.
- **GeoJSON in throttled window** — Calcul du GeoJSON dans la fenêtre `setData` throttlée pour éviter les frames bloquées.

### Internal

- **`CircuitBreaker` class** — Extraction depuis `geocoder.ts` vers une classe réutilisable. Tests unitaires ajoutés.
- **Refactor cache** — `compressToGzBase64` centralisé dans `compression.ts`. `buildUserWritePayload` extrait dans le chunk route.
- **Pre-open-source hardening** — Audit secrets, `.gitignore` renforcé, timing attacks réduits.

---

## [0.3.2] — 2026-04-14

### Performance

- **DB optimisations Neon** — `db:sync:from-neon` : variantes `--repo`, `--limit`, `--tables` pour sync partiel. `SET statement_timeout=0` ajouté en tête de tous les scripts DDL (index + MV). Slow query logger Prisma activé.
- **MVs additionnelles** — `user_repo_count_mv` (per-user repo count, nearby query 6s→200ms). Index GIN trigram sur `login` + `name` (ILIKE search 6s→50ms).

### Internal

- **Tests** — Suite CircuitBreaker (pré-extraction). Corrections des stubs `chunk route` + `github` qui échouaient silencieusement.
- **SEO / a11y / perf audit** — Robots, sitemap, structured data, focus management, aria labels manquants, bundle size.
- **Sécurité** — Pre-open-source hardening : secrets exclus du dépôt, `.gitignore` durci, timing side-channels réduits.

---

## [0.3.1] — 2026-04-13

### Bug Fixes

- **Fix auth Jawg** — `callJawg()` dans `geocoder.ts` envoyait le token uniquement via header `x-api-key`. Ajout du query param `access-token` requis par l'endpoint dédié `starmapper.jawg.io`. Sans ce param, les requêtes Jawg retournaient 401 silencieusement.
- **Fix label geocode explore** — `/api/explore/geocode` reconstruisait le label manuellement avec `p.city` (champ inexistant dans le modèle Jawg Places). Remplacé par `feature.properties.label` que Jawg fournit nativement.
- **Fix tests geocoder** — `geocoder.test.ts` stubbait `JAWGMAP_ACCESS_TOKEN` alors que le code lit `JAWG_TOKEN_HEADER`. 7 tests pré-existants échouaient silencieusement. Corrigé.
- **Docs** — Remplacement de toutes les occurrences de "Pelias" par "Jawg Places" dans `README.md` et `docs/ARCHITECTURE.md`. Jawg Places est basé sur Pelias mais la marque correcte est Jawg Places.

### Internal

- **Consolidation `fetchAndPatchStyle`** — La fonction existait en double : une version inline dans `stargazer-map.tsx` (30 lignes, sans cache) et une version dans `lib/map-style.ts` (avec cache). `lib/map-style.ts` est désormais la source unique. La fonction accepte un paramètre `projection` (`"mercator"` | `"globe"`, défaut `"mercator"`) avec clé de cache composite `${url}#${projection}` pour éviter les collisions globe/mercator.
- **Suppression patches style obsolètes** — `lang=en` retiré des URLs de style dans `theme.ts` et `stargazer-map.tsx` (Jawg gère la langue nativement). Patch glyphs URL retiré (`lib/map-style.ts`, `stargazer-map.tsx`). Remplacement `name:fr → name:en` retiré (`map-style.ts`, `stargazer-map.tsx`).
- **Migration `batch-scan.ts`** — Endpoint geocodage migré de `api.jawg.io` vers `starmapper.jawg.io` (endpoint dédié StarMapper). Token migré de `JAWGMAP_ACCESS_TOKEN` vers `JAWG_TOKEN_HEADER`. Ajout du header `x-api-key`.
- **Refactor CLI scripts** — Les 10 scripts dans `scripts/` utilisent désormais `node:util parseArgs` avec `strict: true` au lieu des patterns ad-hoc `process.argv.includes` / `getArg`. `parseArgs` est natif Node 18+, sans dépendance.

---

## [0.3.0] — 2026-04-10

### Features

- **Language Atlas** — Page `/devs/atlas` : carte choroplèthe mondiale affichant le langage le plus populaire par pays, calculé sur les repos étoilés et contribués. Détail par pays au clic (langage dominant, %, nombre de devs). Bandeau "Early preview" le temps du backfill.
- **Dev Maps par langage** — Pages `/devs` et `/devs/[language]` : carte des développeurs filtrée par langage, avec combobox de sélection.
- **Backfill langages** — Script `backfill-languages.ts` pour alimenter le champ `languages[]` sur `github_user`. Mode `--from-cache` : dérive les langages depuis `star_event + badge_cache` sans appel GitHub (1,23M users en quelques secondes). Mode API : parallélisable via `--token-index`.
- **Materialized view `country_language_stats_mv`** — Agrégation (pays × langage) pour l'Atlas. Créée/rafraîchie automatiquement par `pnpm db:sync` et le cron admin quotidien.

### Performance

- **Backfill 3× plus rapide** — `maxRepositories: 30 → 10` (moins de points GraphQL consommés), batch par défaut `10 → 50`, bulk UPDATE via `unnest()` (1 requête SQL au lieu de N individuelles).

### Bug Fixes

- **db:sync** — `github_user` passait de `DO NOTHING` à `DO UPDATE` : les colonnes `languages` et `languagesFetchedAt` n'étaient jamais poussées vers Neon. Corrigé.
- **db:sync** — Création automatique de `country_language_stats_mv` sur Neon lors du sync si elle n'existe pas encore.

### Internal

- **`LANGUAGE_COLORS`** — Map de 24 langages vers des couleurs distinctives dans `src/lib/language-colors.ts`.
- **`LanguageChoropleth`** — Composant MapLibre choroplèthe (dynamic import `ssr: false`).
- **Copy Atlas** — Wording "gravitate toward" et "favor" plutôt que "use" / "dominant" (données = affinité, pas pratique certifiée).

---

## [0.2.0] — 2026-03-31

### Security

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

### Features

- **Find me** — Username GitHub sauvegardé en localStorage. Premier usage : prompt inline. Visites suivantes : un clic pour voler vers son propre pin sur la carte.
- **Badge button sidebar** — Bouton "Badge" dans la sidebar (entre History et Share) → mini-modal avec preview live, code Markdown sélectionnable, bouton "Copy" avec feedback.
- **Badge dans Share modal** — Section "README badge" en bas du panneau Share.
- **Explore page 2 colonnes** — Leaderboard tabs (gauche) + carte sticky (droite), toujours visible. Largeur max portée à `max-w-7xl`.
- **Recherche + tri liste repos owner** — Filtre par nom/description, 4 modes de tri (stars desc/asc, A–Z, Z–A).
- **Stats panel : tri publicRepos** — Top users triables par followers ou dépôts publics. Export CSV derrière flag env.
- **Token requis pour rescan** — Rescan complet et delta refresh nécessitent désormais un token GitHub (icône verrou affiché).
- **Footer landing** — Boutons pill "by Florian Bruniaux" et "Follow" avec liens portfolio/GitHub.
- **Pagination community maps** — Tableau paginé (20 lignes/page) avec boutons Prev/Next. Limite API portée de 50 à 200 repos.

### Performance

- **Compression gzip client-side** — Données de scan compressées côté client (Web CompressionStream, gzip+base64) avant `POST /api/stargazer-cache`. Résout la perte silencieuse du cache sur les repos >~15k étoiles (payload brut ~15MB > limite Vercel 4.5MB). Payload réduit à ~800KB.
- **Geocache GeoNames** — Pre-seeding de ~51k entrées (villes pop >15k + pays + codes ISO2/ISO3). Hit rate >99% sur les scans réels.
- **Nettoyage geocache** — 36 entrées garbage supprimées (#hashtags, $variables shell, `[object Object]`, artifacts XSS, templates Jinja).
- **DB portabilité** — Adaptateur conditionnel dans `db.ts` : `DATABASE_DRIVER=standard` → `@prisma/adapter-pg` (Docker, Railway, Supabase) ; défaut → `@prisma/adapter-neon`. L'auto-hébergement sans Neon fonctionne.
- **DB optimisations** — Index ajoutés sur les chemins de requête chauds, caps de résultats (`take: 10_000`), health guard TTL-aware.

### Bug Fixes

- **Bug antimeridian** — La Russie et autres pays croisant le 180° causaient un triangle artifact sur la carte choroplèthe. Fix : normalisation des rings polygone pour qu'aucun sommet adjacent ne diffère de plus de 180° en longitude.
- **MapLibre Web Worker CSP** — Ajout de `worker-src blob:` (bloquait le web worker MapLibre → carte blanche sur certaines configs).
- **React hydration** — Accès à `localStorage` pendant le render SSR causait React error #418. Fix : état initialisé SSR-safe, synchronisé via `useEffect`.
- **Race condition pre-scan modal** — La modale de pré-scan apparaissait brièvement sur les repos déjà indexés. Fix : état `cacheCheckDone`.
- **Geocoder** — Filtre `isGeocodeableLocation` étendu aux préfixes `#$<>[{"!`.

### Internal

- **Licence AGPL-3.0-only** — Headers SPDX sur les 50 fichiers source, fichier NOTICE.
- **Refactoring API** — Libs partagées : `api-validation.ts`, `api-helpers.ts`, `compression.ts`, `compress-client.ts`. Remplacement de 10 patterns dupliqués sur 15 route handlers.
- **Conventions code** — Routes API converties en const arrow functions. `interface` → `type`. `import type` pour les imports type-only.
- **Scripts** — `batch-scan.ts` : écritures FLUSH_EVERY incrémentales, cache géocodage session-level, meilleure récupération sur erreur.
- **Dependabot** — Mises à jour hebdomadaires des dépendances sur main.
- **Prisma 7.5 → 7.6** — Corrige 12 vulnérabilités (3 high, 8 moderate, 1 low) dans la chaîne dev transitive.

---

## [0.1.0] — 2026-03-26

Version initiale publique.

### Features

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

### Performance

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
