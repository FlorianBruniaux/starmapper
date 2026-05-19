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

## 7 Materialized Views + GIN indexes

Non gérés par Prisma — doivent être créés une fois par instance DB :

```bash
pnpm db:setup   # applique prisma db push + crée les 7 MVs + pg_trgm indexes
```

MVs : `github_user_grid_mv`, `country_stats_mv`, `power_users_mv`, `company_stats_mv`, `country_language_stats_mv`, `user_repo_count_mv`, `trending_repos_mv`

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
