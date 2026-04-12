# REPRISE — Language Atlas + Backfill

_Dernière mise à jour : 2026-04-10_

---

## État actuel

**Repo propre** — tout commité et pushé sur `main`.

La feature Language Atlas est complète (commit `98e6e53`). La MV est gérée
par `db-sync` qui la crée automatiquement sur Neon si manquante (commit `188303f`).

---

## Backfill languages — comment reprendre

### Commande de reprise (prod)

```bash
# 1 terminal par token, adapter le cursor au dernier affiché avant arrêt
pnpm backfill:languages:prod --token-index 0 --cursor <login_token1> --batch 50
pnpm backfill:languages:prod --token-index 1 --cursor <login_token2> --batch 50
pnpm backfill:languages:prod --token-index 2 --cursor <login_token3> --batch 50
```

### Vérifier la couverture actuelle en prod

```sql
SELECT
  ROUND(100.0 * COUNT(*) FILTER (WHERE "languagesFetchedAt" IS NOT NULL)
        / NULLIF(COUNT(*), 0), 1) AS coverage_pct,
  COUNT(*) FILTER (WHERE "languagesFetchedAt" IS NOT NULL) AS done,
  COUNT(*) AS total
FROM github_user WHERE lat IS NOT NULL;
```

### Rafraîchir la MV après avancée significative du backfill

```bash
pnpm refresh:country-language-mv:prod
```

### Pourquoi c'est lent

`commitContributionsByRepository(maxRepositories: 10)` — 1 GraphQL call par batch de 50 users.
~5000 pts/heure/token → ~3000–5000 users/heure/token avec batch=50.
3 tokens = ~9000–15000 users/heure → ETA ~100–150h pour 1.4M users.

### Ajouter des tokens pour accélérer

Dans `.env.local` (et `.env` en prod sur Vercel) :
```
GITHUB_TOKEN_4=ghp_xxx
GITHUB_TOKEN_5=ghp_xxx
```
Puis lancer des processus supplémentaires avec `--token-index 3`, `--token-index 4`.

---

## Déployer une mise à jour

```bash
pnpm build && vercel --prod
```

La MV est créée/rafraîchie automatiquement par `db-sync` et le cron `/api/admin/refresh-grid-mv` (03:00 UTC).
