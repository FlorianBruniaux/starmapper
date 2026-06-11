# Known Gotchas — StarMapper (Auto-loaded)

Gotchas à lire avant de toucher ces zones.

---

## Prisma 7 + Neon Adapter

`schema.prisma` n'a **pas de champ `url`** — intentionnel avec l'adapter pattern Prisma 7. La connection string est passée à l'adapter dans `db.ts`, pas via le schema.

| `DATABASE_DRIVER` | Adapter | Usage |
|---|---|---|
| `neon` (défaut) | `@prisma/adapter-neon` | Vercel + Neon (HTTP) |
| `standard` | `@prisma/adapter-pg` | Docker, Railway, Supabase |

Après tout `prisma db push` → relancer `pnpm backfill:api-key-hash` pour peupler `keyHash` sur les ApiKey existantes.

---

## MapLibre GL 5.x

`getClusterExpansionZoom` est **Promise-based**, plus callback :

```ts
// ✅ v5
source.getClusterExpansionZoom(clusterId)
  .then((zoom) => map.easeTo({ center: coords, zoom }))
  .catch(() => {});
```

---

## StargazerCache — compression obligatoire

Toujours envoyer `pointsGz`/`unmappedGz` (gzip+base64), jamais les arrays bruts. Un repo 50k+ stars = ~15MB raw > limite Vercel 4.5MB.

```ts
// ✅ Format attendu par POST /api/stargazer-cache
{ owner, repo, pointsGz: string, unmappedGz: string, totalCount: number }
```

---

## Neon DDL — contraintes

- **Jamais `CREATE INDEX CONCURRENTLY`** → déclenche `PANIC: [NEON_SMGR] Page evicted with zero LSN`
- Toujours préfixer les scripts DDL avec `SET statement_timeout = 0;`
- Migrations : `prisma db push` uniquement, jamais `prisma migrate dev`

---

## Pool SSL local : gate sur NODE_ENV

Toute route qui ouvre son propre `pg.Pool` (hors singleton `db.ts`) doit gater le SSL sur l'env, sinon ça crash en local :

```ts
// ✅ Neon (prod) exige SSL, Postgres local ne le supporte pas
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
```

Sans le gate : `error: The server does not support SSL connections` au premier `connect()` local. Concerné : `refresh-trending/route.ts` (corrigé), `refresh-grid-mv/route.ts` (SSL hardcodé mais ne tourne qu'en prod).

---

## Cron trending : migrer la DB avant que le code parte en prod

Le cron `30 */6 * * *` (`/api/admin/refresh-trending`) appelle `selectRefreshTargets` qui lit `trending_watchlist` + `trending_refresh`. Si le code est déployé avant le `prisma db push` sur Neon, le cron throw toutes les 6h (tables inexistantes). Inoffensif si `CRON_SECRET` non défini (route → 404). Pas de corruption : `/trending` continue sur le MV existant. Migration prod = push schema + recréer le MV 30j (`scripts/db/sql/create-trending-mv.sql`) + seed watchlist.

---

## 9 Materialized Views + GIN indexes

Non gérés par Prisma. À créer une fois par instance DB :

```bash
pnpm db:setup   # applique prisma db push + crée les 9 MVs + pg_trgm indexes
```

MVs : `github_user_grid_mv`, `country_stats_mv`, `power_users_mv`, `company_stats_mv`, `country_language_stats_mv`, `user_repo_count_mv`, `language_grid_mv`, `trending_repos_mv`, `city_stats_mv`

Routes qui tombent silencieusement si les MVs manquent : `/trending` (503), `/devs/atlas` (vide), `/explore` (timeout search).

---

## AnnouncementBanner — BANNER_ID

Dismissal stocké en localStorage par `BANNER_ID`. Pour forcer la réapparition (nouvelle feature), bumper le string dans `src/components/announcement-banner.tsx`.

```ts
const BANNER_ID = "announce-explore-v1"; // → "announce-explore-v2" pour la prochaine annonce
```

Un hook `PostToolUse` rappelle de le faire quand un `page.tsx` ou `route.ts` est créé.

---

## GitHub GraphQL cursor

Ne jamais passer `cursor: null` comme variable GraphQL — omettre la variable ou passer `undefined`.

---

## DB Health Guard

`src/lib/user-cache.ts` appelle `checkDbHealth()` avant chaque write. Si le DB est > 95% capacité, les writes `GitHubUser`/`StarEvent` sont silencieusement ignorés. Intentionnel.

---

**Auto-loaded**: ce fichier est chargé automatiquement à chaque session.
