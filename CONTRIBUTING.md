# Contributing to StarMapper

## Local setup

```bash
git clone <your-fork>
cd starmapper
cp .env.example .env.local   # fill in required values
pnpm install
pnpm db:setup                # prisma db push + materialized views + indexes
pnpm dev
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full explanation of how the chunk loop, geocoder cascade, and caching layers work.

## Before opening a PR

```bash
pnpm typecheck   # must pass — 0 errors
pnpm lint        # must pass
pnpm test        # must pass
```

Commit format: `type(scope): lowercase message` (max 50 chars). Scopes: `map`, `api`, `geocoder`, `cache`, `badge`, `github`, `db`, `ui`, `admin`, `config`, `deps`. See `CLAUDE.md` section VIII for the full list.

Sign-off required (DCO v1.1):

```bash
git commit -s -m "fix(geocoder): handle null location from GraphQL"
```

## What to work on

Check [GitHub Issues](../../issues) for `good first issue` labels. Read "Out of Scope" in [CLAUDE.md](CLAUDE.md) before proposing large features.

## Environment variables

See `.env.example` for the full list. Minimum to run locally: `DATABASE_URL`, `GITHUB_TOKEN`, `NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN`.

Without `JAWG_TOKEN_HEADER` + `GEOAPIFY_APIKEY`, geocoding falls back to Nominatim only — slow for repos > 200 stars (1.1 s/user), but functional.

## Database setup details

After `prisma db push`, run:

```bash
pnpm db:setup
```

This creates 7 materialized views and pg_trgm indexes that Prisma cannot manage. Without them: trending returns 503, dev atlas is empty, and login search timeouts on large datasets.
