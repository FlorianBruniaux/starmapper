# Audit Multi-Axes StarMapper — Rapport Consolidé

**Date**: 2026-04-13
**Axes audités**: Architecture · Backend · Frontend · Système · Sécurité
**Agents**: architect-review · backend-architect · frontend-architect · system-architect · security-auditor · security-patcher

---

## Executive Summary

| Sévérité | Axe Architecture | Backend | Frontend | Système | Sécurité | **Total unique** |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| CRITICAL | 2 | 2 | 3 | 3 | 0 | **8** |
| HIGH | 4 | 5 | 6 | 6 | 3 | **17** |
| MEDIUM | 4 | 6 | 6 | 7 | 5 | **~20** |

3 findings CRITICAL sont confirmés par plusieurs agents (cross-validated).
4 patches de code sont fournis pour les findings sécurité HIGH/MEDIUM.

---

## CRITICAL — À corriger en priorité absolue

### C1 — Nominatim delay 300ms au lieu de 1100ms `[ARCH + BACKEND + SYSTEM]`

**Fichier**: `src/lib/geocoder.ts:350`

Quand Jawg ET Geoapify sont en circuit ouvert, Nominatim est appelé avec 300ms entre chaque appel. La polite use policy de Nominatim exige 1 req/s minimum (1000ms). La constante dans le commentaire ligne 346 dit "1100ms delay" — contradiction directe avec le code.

**Risque**: Ban IP Nominatim = zéro geocoding pour tous les utilisateurs sur l'instance Vercel, sans alerte.

```diff
// geocoder.ts:350
-await sleep(300);
+await sleep(1100);
```

---

### C2 — `cursor: null` envoyé en variable GraphQL `[ARCH + BACKEND]`

**Fichier**: `src/lib/github.ts:78`

`JSON.stringify({ variables: { owner, repo, cursor } })` sérialise `cursor: null` sur la première page. Le spec GraphQL traite `null` et l'omission de variable différemment pour un `String` non-nullable. Comportement incorrect, peut provoquer des erreurs 422 selon la version de l'API GitHub.

```diff
// github.ts:78
-body: JSON.stringify({ query, variables: { owner, repo, cursor } })
+body: JSON.stringify({ query, variables: cursor ? { owner, repo, cursor } : { owner, repo } })
```

---

### C3 — `startRefresh` (delta scan) n'écrit jamais dans StargazerCache DB `[ARCH]`

**Fichier**: `src/app/[owner]/[repo]/page.tsx:474-542`

Après un refresh scan, le résultat mergé est sauvé en `localStorage` + badge-update appelé, mais `POST /api/stargazer-cache` n'est jamais appelé. Le visiteur suivant charge la version stale depuis la DB (potentiellement avec des milliers d'étoiles manquantes).

**Fix**: Appeler `POST /api/stargazer-cache` avec `mergedPoints` + `mergedUnmapped` à la fin de `startRefresh`, comme `startScraping` le fait aux lignes 448-463.

---

### C4 — `/api/recalculate-location` : endpoint d'écriture sans auth `[BACKEND + SYSTEM + SECURITY]`

**Fichier**: `src/app/api/recalculate-location/route.ts:12`

N'importe quelle requête non authentifiée avec un `login` valide peut supprimer son entrée geocache et déclencher un appel Nominatim en live. Classifié `"exempt"` dans le middleware. Abuse vector pour vider le geocache + épuiser le quota Nominatim.

**Fix**: Ajouter `requireAdminAuth(req)` ou vérifier le SM token en tête de handler.

---

### C5 — Modals d'erreur avec `fixed inset-0` sur mobile `[FRONTEND]`

**Fichier**: `src/app/[owner]/[repo]/page.tsx:880, 915`

Sur iOS Safari avec clavier virtuel actif, `position: fixed` est positionné par rapport au visual viewport qui se décale. Les modals d'erreur (`repoRateLimited`, `repoNotFound`) peuvent être clipés ou inaccessibles.

```diff
// page.tsx:880 et :915
-className="fixed inset-0 ...
+className="absolute inset-0 ...
```

---

### C6 — `setDataTimerRef` timeout non annulé au démontage `[FRONTEND]`

**Fichier**: `src/components/map/stargazer-map.tsx:707-711`

Le cleanup `useEffect` appelle `map.remove()` mais ne fait pas `clearTimeout(setDataTimerRef.current)`. Si le timer de 2s se déclenche après le démontage, il appelle `setData()` sur une map détruite → exception MapLibre. Reproduit systématiquement sous React 18 Strict Mode.

```diff
// stargazer-map.tsx (dans le cleanup useEffect)
+if (setDataTimerRef.current) clearTimeout(setDataTimerRef.current);
 map.remove();
 mapRef.current = null;
```

---

### C7 — Circuit breakers in-memory, par instance Lambda `[SYSTEM]`

**Fichier**: `src/lib/geocoder.ts:14-51`

`jawgErrorCount` et `geoapifyErrorCount` sont des variables module-level. Vercel peut spawner N instances Lambda concurrentes, chacune avec son propre compteur. Instance A peut ouvrir le circuit Jawg pendant qu'Instance B commence à 0 et hammer Jawg. La protection circuit breaker est donc N fois plus faible que documenté.

**Fix**: Utiliser Upstash Redis (env vars déjà présents) pour les compteurs de circuit breaker distribués.

---

### C8 — `refresh-grid-mv` : 5 refreshes MV concurrents avec timeout 10s `[SYSTEM]`

**Fichier**: `src/app/api/admin/refresh-grid-mv/route.ts:34-40`

`Promise.all([...])` sur 5 `REFRESH MATERIALIZED VIEW CONCURRENTLY`. À l'échelle actuelle (11.9M star_events, 4.3M github_users), `power_users_mv` et `country_language_stats_mv` peuvent dépasser 10s chacun. En cas de timeout Vercel, les 5 refreshes sont abandonnés silencieusement → MVs stale indéfiniment.

**Fix**: Passer en séquentiel, ou séparer en cron jobs individuels, ou ajouter alerting explicite.

---

## HIGH — À corriger dans le prochain sprint

| # | Finding | Fichier | Axe |
|---|---------|---------|-----|
| H1 | `jawgCircuitOpenAt` / `geoapifyCircuitOpenAt` jamais remis à 0 après reset | `geocoder.ts:22-24` | Arch + Backend |
| H2 | `StargazerCache.expiresAt` défini en schema mais jamais appliqué → table grandit sans bound | `prisma/schema.prisma:39-42` | Arch |
| H3 | `/api/explore/user-repos` ne valide pas le param `login` (pas de `LOGIN_RE`) | `explore/user-repos/route.ts:22` | Backend |
| H4 | `/api/map-image` utilise `normalizeOwnerRepo` au lieu de `validateOwnerRepo` | `map-image/[owner]/[repo]/route.ts:150` | Backend |
| H5 | `/api/admin/import-geocache` n'applique pas `toLowerCase().trim()` sur les clés | `admin/import-geocache/route.ts:21` | Backend |
| H6 | `FilterCombobox` : pas d'ARIA (`aria-expanded`, `role="listbox"`, `role="option"`) | `filter-combobox.tsx:73-88` | Frontend |
| H7 | `FilterCombobox` touch target ~14px (min WCAG : 44px) | `filter-combobox.tsx:77` | Frontend |
| H8 | `profileFetchCache` map module-level, jamais purgée (leak mémoire long session) | `stargazer-map.tsx:335` | Frontend |
| H9 | `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN` exposé côté client sans restriction d'origin Jawg | `stargazer-map.tsx:37` | Sécurité |
| H10 | `POST /api/badge-update` sans vérification SM token → stats fabricables | `badge-update/route.ts` | Sécurité |
| H11 | Comparaison `ADMIN_SECRET` non constant-time (timing attack) | `api-helpers.ts:42-44` | Sécurité |
| H12 | `Redis.fromEnv()` crash middleware au cold start si env vars manquantes | `middleware.ts:15` | Système |
| H13 | GraphQL query fetch `socialAccounts` sur chaque stargazer → consomme plus de quota GitHub | `github.ts:56-62` | Système |

---

## Patches sécurité fournis (prêts à appliquer)

### Patch H10 — `badge-update` : ajout vérification SM token

**Fichier**: `src/app/api/badge-update/route.ts` — Ajouter après validation des params (`lang`):

```ts
// Session token check — mirrors POST /api/stargazer-cache
const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
if (SM_SECRET) {
  const smToken = req.cookies.get(COOKIE_NAME)?.value;
  if (!await verifyToken(smToken, SM_SECRET)) {
    return jsonError("forbidden", 403);
  }
}
```

Imports à ajouter: `import { verifyToken, COOKIE_NAME } from "@/lib/api-token";`

---

### Patch H11 — Comparaison admin secret constant-time

**Step 1** — `src/lib/api-token.ts`: exporter `safeEqual`:
```diff
-const safeEqual = (a: string, b: string): boolean => {
+export const safeEqual = (a: string, b: string): boolean => {
```

**Step 2** — `src/lib/api-helpers.ts`:
```diff
+import { safeEqual } from "@/lib/api-token";
...
-if (!secret || req.headers.get("x-admin-secret") !== secret) {
+if (!secret || !safeEqual(req.headers.get("x-admin-secret") ?? "", secret)) {
```

---

### Patch M4 — Paramètre `country` non sanitisé dans requêtes ILIKE

**Fichier**: `src/app/api/explore/locations/route.ts` et `src/app/api/explore/companies/route.ts`:
```diff
-const country = searchParams.get("country") ?? "";
+const country = (searchParams.get("country") ?? "").substring(0, 100).replace(/[^\p{L}\p{N}\s'.,()-]/gu, "");
```

---

### Patch M1 — `$queryRawUnsafe` → `$queryRaw` tagged templates

**Fichier**: `src/app/api/devs/[language]/route.ts` — Convertir les 3 appels `$queryRawUnsafe(..., language)` en `$queryRaw\`... ${language} ...\`` pour que Prisma paramétrise automatiquement. Le patch complet est dans le rapport sécurité-patcher.

---

## MEDIUM — Backlog

| # | Finding | Fichier | Impact |
|---|---------|---------|--------|
| M1 | `$queryRawUnsafe` → `$queryRaw` tagged templates (maintenance risk) | `devs/[language]/route.ts` | Sécurité |
| M2 | `checkReferer` bypassable avec curl (sans SM_TOKEN_SECRET défini) | `middleware.ts:141` | Sécurité |
| M3 | `setData()` sans guard `map.isStyleLoaded()` dans certains paths | `stargazer-map.tsx:718` | Frontend |
| M4 | `dangerouslySetInnerHTML` JSON-LD : risque XSS si data dynamique future | `layout.tsx:173` | Sécurité |
| M5 | `CSP: script-src 'unsafe-inline'` → migrer vers nonce-based CSP | `next.config.ts:37` | Sécurité |
| M6 | `badge-update` n'a pas de DB health guard | `badge-update/route.ts` | Backend |
| M7 | `startScraping` ferme sur `repoInfo?.language` non inclus dans deps | `page.tsx:438` | Frontend |
| M8 | Bouton fermeture drawer unmapped sans `aria-label` | `page.tsx:1166` | Frontend |
| M9 | Couleurs hardcodées LinkedIn (`bg-[#0a66c2]`) — violation design system | `page.tsx:1829` | Frontend |
| M10 | Rate limiter Redis fail-open sans log warning | `middleware.ts:129` | Sécurité |
| M11 | `clear-geocache` supprime uniquement lat=null, pas tout le geocache | `admin/clear-geocache/route.ts:17` | Backend |
| M12 | Cleanup GDPR charge tous les logins stale en mémoire Node | `admin/cleanup/route.ts:40` | Système |
| M13 | `/api/repos` accepte `?limit=10000` sans pagination | `repos/route.ts:28` | Backend |
| M14 | `compare scan` avale silencieusement les erreurs | `page.tsx:602` | Frontend |

---

## Roadmap suggérée

### Sprint 1 — Critique production (semaine 1)
- [ ] C1: Fix Nominatim delay 1100ms (`geocoder.ts:350`)
- [ ] C2: Fix cursor:null GraphQL (`github.ts:78`)
- [ ] C3: Write stargazer-cache après startRefresh (`page.tsx`)
- [ ] C4: Auth guard `/api/recalculate-location`
- [ ] C5: `fixed` → `absolute` modals erreur mobile (`page.tsx:880, 915`)
- [ ] C6: Cleanup `setDataTimerRef` sur unmount (`stargazer-map.tsx`)
- [ ] H1: Reset `jawgCircuitOpenAt` = 0 dans isJawgAvailable (`geocoder.ts`)
- [ ] Appliquer patch H10 (badge-update SM token) — 10 lignes
- [ ] Appliquer patch H11 (admin constant-time) — 3 lignes
- [ ] Appliquer patch M4 (country ILIKE sanitization) — 2 lignes

### Sprint 2 — Robustesse (semaine 2)
- [ ] C7: Circuit breakers distribués via Upstash Redis
- [ ] C8: refresh-grid-mv séquentiel + alerting
- [ ] H2: Enforce StargazerCache.expiresAt (cleanup cron)
- [ ] H6/H7: FilterCombobox ARIA + touch target
- [ ] H12: Redis.fromEnv() lazy init dans middleware
- [ ] H13: Retirer socialAccounts du GraphQL query
- [ ] Appliquer patch M1 ($queryRawUnsafe)
- [ ] H9: Configurer restriction d'origin Jawg dans Back Office

### Sprint 3 — Excellence technique (semaine 3-4)
- [ ] H8: Purge `profileFetchCache` (cap à 200 entrées LRU)
- [ ] H3/H4/H5: Validation owner/repo et geocache keys manquantes
- [ ] M5: Nonce-based CSP
- [ ] M2: Vérifier que SM_TOKEN_SECRET est défini en prod Vercel
- [ ] Tests: couvrir geocoder.ts, github.ts, user-cache.ts (Phase 1 TDD mandate)
- [ ] Sentry ou équivalent pour error tracking

---

## Ce qui fonctionne bien (ne pas toucher)

- Chunk loop architecture : correctement implémentée, stays under 10s
- Prisma 7 + Neon adapter pattern : textbook correct
- MapLibre v5 Promise API : `getClusterExpansionZoom` correctement migré
- Geocache-first + bulk read : évite les appels API inutiles
- Compression pipeline gzip+base64 : correct et testé pour 50k+ repos
- SM token HMAC sur stargazer-cache write : 3 couches de protection solides
- SSR exclusion MapLibre : dynamic import + `ssr: false` partout
- Rate limiting Upstash distribué : bonne architecture
- GDPR erasure route : correctement implémentée avec audit log
- SQL injection : aucune vulnérabilité active trouvée
- Secrets : aucun token hardcodé dans le code source
