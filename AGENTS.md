# StarMapper — AI Agent Guide

## Build

```bash
pnpm install
pnpm typecheck   # must pass before any commit
pnpm lint
pnpm test
```

## Stack

Next.js 16 (App Router), TypeScript 5, MapLibre GL 5.x, Prisma 7 + Neon Postgres, Tailwind CSS v4.

## Key conventions

- Arrow functions only (`const fn = () => {}`), never `function` keyword
- `type` over `interface`, `import type` for type-only imports
- No `any` — use `unknown` + type guards
- Tailwind: CSS tokens from `@theme` in `globals.css`, no arbitrary values (`w-[Npx]`)
- MapLibre components: dynamic import with `ssr: false`, cleanup on unmount

## Architecture notes

- `/api/chunk` is the critical path — called in a client-side loop, 100 users per call
- Geocoder: 3-tier cascade Jawg → Geoapify → Nominatim, with a DB geocache (~51k pre-seeded entries)
- Prisma adapter: `@prisma/adapter-neon` by default, `@prisma/adapter-pg` when `DATABASE_DRIVER=standard`
- `schema.prisma` has no `url` field — intentional with Prisma 7 adapter pattern
- MapLibre GL 5.x: `getClusterExpansionZoom` is Promise-based, not callback-based

## DB setup (after prisma db push)

7 materialized views and pg_trgm indexes are required but not managed by Prisma. Run:

```bash
pnpm db:setup
```

See `scripts/db-setup.sh` and `docs/ARCHITECTURE.md` for details.


<claude-mem-context>
# Memory Context

# [starmapper] recent context, 2026-05-17 11:48am GMT+2

No previous sessions found.
</claude-mem-context>