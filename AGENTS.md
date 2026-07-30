# StarMapper — Codex Agent Guide

## Priority

StarMapper no longer has reliable access to arbitrary public repo stargazer
enumeration. GitHub restricted `Repository.stargazers`, REST stargazers, REST
subscribers/watchers, and the UI stargazer/watchers pages in July 2026.

The current product priority is the GitHub pivot documented in
`docs/ROADMAP.md` and `claudedocs/`:

1. Fix stale/misleading surfaces first, especially historical trending labels.
2. Ship honest map source handling: historical cache, engaged audience, then
   owner-authorized live stargazers.
3. Keep any mass crawl of `starredRepositories(user)` blocked unless the
   explicit legal/ToS decision is clean. Do not treat this as an engineering
   workaround.

Do not spend time on medium-term features until the pivot surfaces are honest.

## Sources Of Truth

Read the relevant files before changing code. For pivot or data-source work,
read these first:

- `docs/ROADMAP.md`
- `claudedocs/github-stargazers-restriction.md`
- `claudedocs/github-api-surface-inventory.md`
- `claudedocs/pivot-action-plan.md`
- `claudedocs/github-access-probe-2026-07-24.json` when raw probe evidence is needed

For implementation rules, prefer:

- `CLAUDE.md` for stack, architecture, env vars, commands, and gotchas
- `.claude/rules/architecture.md` for chunk loop, geocoder, GitHub, API route contracts
- `.claude/rules/code-conventions.md` for TypeScript and React style
- `.claude/rules/known-gotchas.md` for Prisma, MapLibre, MVs, cursor, geocodeBatch
- `.claude/rules/tdd-mandatory.md` for tests
- `.claude/rules/defensive-code-audit.md` for forbidden error-handling patterns
- `.claude/rules/design-system.md` and `docs/design-system.md` for UI tokens
- `docs/ARCHITECTURE.md` for endpoint and file map reference

This file is the Codex entry point. Do not paste stale Claude memory blocks into
it. Link to the detailed docs instead of duplicating them.

## Codex Tooling And Skills

- Use repository instructions plus Codex skills together. If a task matches an
  available skill, read that skill's `SKILL.md` before acting.
- Use `tool_search` for deferred MCP/plugin tools when the request mentions
  GitHub, Vercel, automations, threads, browser control, document control, or
  another connector.
- Use `grepai search "english intent" --json --compact` first for semantic code
  exploration. Fall back to `rg` for exact symbols, imports, strings, and paths.
- Use `rtk` whenever an equivalent exists for CLI commands. Common checks:
  `rtk tsc`, `rtk vitest run`, `rtk git status --short`.
- For library/framework/API docs, prefer the official/source-backed tool path
  available in the session, such as Context7 for library docs and Vercel skills
  for Vercel-specific work.
- Do not invent plugin access. If a connector/plugin is missing, say so and use
  the best available fallback.

## Stack

- Next.js 16.2.11 App Router, React 19.2, Turbopack
- TypeScript 6, strict zero-error policy
- MapLibre GL 5.24.x
- Prisma 7.8 + `@prisma/adapter-neon`, Neon Postgres
- Tailwind CSS v4 with `@theme inline` tokens in `src/app/globals.css`
- Vercel, Upstash Redis for distributed rate limiting
- Jawg dedicated geocoding, Jawg Places, Geoapify, Nominatim fallback

## Commands

```bash
pnpm install
pnpm dev
pnpm build
rtk tsc
pnpm lint
rtk vitest run
pnpm test
pnpm db:setup
```

Before any commit, `rtk tsc` must pass. Run the narrowest relevant tests for the
change, then broader tests when touching shared contracts, API routes, DB writes,
or map source behavior.

The Vercel CLI installed in this environment may be outdated. If Vercel CLI
behavior is relevant, recommend upgrading with `pnpm add -g vercel@latest` or
`npm i -g vercel@latest` before relying on new CLI behavior.

## Non-Negotiable Code Rules

- Arrow functions only: `const fn = () => {}`. Do not use `function`.
- Use `type`, not `interface`.
- Use `import type` for type-only imports.
- No `any`; use precise types or `unknown` plus narrowing.
- Kebab-case file and folder names.
- 2 spaces, double quotes, semicolons, trailing commas in multiline structures.
- No silent catches in API routes. Return a typed error response or rethrow.
- No `forEach(async ...)`; use `for...of` or `Promise.all(items.map(...))`.
- Do not introduce hardcoded secrets, tokens, coordinates, or magic URLs.
- Do not make broad refactors while fixing a narrow issue.

## UI Rules

- Use Tailwind tokens from `src/app/globals.css`. No arbitrary values like
  `w-[40px]`, `text-[12px]`, or `bg-[#0d1117]`.
- Use existing classes such as `bg-background`, `bg-surface`, `text-foreground`,
  `text-muted`, `border-border`, and `text-accent-blue`.
- MapLibre DOM and popup specifics live in JS/CSS outside Tailwind when needed.
- Do not use `position: fixed` on mobile overlays without checking keyboard
  behavior.
- Interactive controls need visible focus states and mobile touch targets.

## Database And Prisma

- `schema.prisma` intentionally has no datasource `url`; runtime connection is
  passed through Prisma adapters in `src/lib/db.ts`.
- `DATABASE_DRIVER=neon` is the default for Vercel/Neon. `standard` is for
  local Docker/Railway/Supabase-style Postgres.
- Use `prisma db push`, not `prisma migrate dev`.
- After `prisma db push`, run the required follow-up for affected data, notably
  `pnpm backfill:api-key-hash:*` when `ApiKey.keyHash` can be missing.
- Neon DDL rule: never `CREATE INDEX CONCURRENTLY`; prefix DDL with
  `SET statement_timeout = 0;`.
- Materialized views are not managed by Prisma. `pnpm db:setup` creates the
  current MV/index set. `repo_power_users_mv` depends on `power_users_mv`.
- Repo stats precompute is controlled by `REPO_STATS_MV_ENABLED`. In production,
  keep it enabled when `repo_stats_mv` and the three repo dimension MVs are
  populated and fresh; otherwise `/api/stats/[owner]/[repo]` can fall back to
  expensive live joins and timeout. See `docs/adr-repo-stats-precompute.md`.
- `src/lib/user-cache.ts` can skip writes when DB health is critical. Long-running
  crawls must treat skipped writes as retryable, not complete.

## GitHub Data Reality

Dead or unreliable for arbitrary repos:

- GraphQL `Repository.stargazers`
- REST `/repos/{owner}/{repo}/stargazers`
- REST `/repos/{owner}/{repo}/subscribers`
- UI `/stargazers` and `/watchers`

Still useful:

- Scalar `repository.stargazerCount`
- Inverse `user.starredRepositories`
- Repo engaged channels: forks, issues, pull requests, mentionable users,
  contributors, and GraphQL watchers while it remains available
- Followers/following, contributors, dependents, trending/atlas/explore reads
  over existing DB data

Use honest naming:

- Historical cache can say "stargazers", but must show freshness.
- Engaged audience must not be labelled as stargazers.
- Owner-authorized live access can say "stargazers" only when ownership/token
  access is proven.

## Current Pivot Direction

The architecture should converge on a first-class map source discriminant:

```ts
type RepoMapSource = "history" | "engaged" | "owner-live";
```

Propagate source and coverage through route responses, map UI, stats, badges,
Open Graph images, exports, and copy. Avoid coercing engaged users into
stargazer terminology just to reuse legacy components.

Near-term expected sequence:

1. Freeze or relabel stale historical/trending surfaces.
2. Add source-aware map serving and coverage metadata.
3. Serve engaged audience for arbitrary repos with explicit copy.
4. Add owner-authorized live stargazers only if the GitHub exemption is verified.
5. Deprecate arbitrary `/api/chunk` scans with a clear `410 Gone` path.

## Critical Existing Contracts

- Old chunk loop was browser-orchestrated and sequential: one `/api/chunk` call
  per 100 users. Do not replace it with a long server loop.
- GitHub GraphQL cursor variables must omit null cursors. Do not pass
  `cursor: null`.
- `geocodeBatch()` returns a `Map` keyed by the raw input location string, not by
  normalized lowercase keys.
- Nominatim fallback must stay sequential with at least 1100 ms between calls.
- `StargazerCache` writes should use `pointsGz` and `unmappedGz`.
- MapLibre `getClusterExpansionZoom` is Promise-based in v5.
- Map sources should update with `source.setData()`; do not remove/re-add sources
  on every points update.

## Rate Limiting

`proxy.ts` is the Next.js 16 middleware entrypoint. Keep one IP rate-limit check
per public POST route there. Do not reintroduce a second identical IP limiter
inside `chunk`, `track`, `followers-chunk`, or `contributors-chunk`.

Per-PAT or per-token limiters inside routes are a different axis and may remain.

The July 2026 production incident was caused by duplicate Upstash checks and the
Free Tier command quota being exhausted. Treat Redis command count as a real
production budget.

## Tests And Verification

- New code in `src/lib/` and `src/app/api/` needs tests.
- For route changes, test validation, success, expected fallback, and error
  shape.
- For source/coverage changes, test terminology and the source discriminant.
- For DB writes, test DB-health skip behavior where relevant.
- For map/UI changes, run a browser check when feasible.

Before handing off:

```bash
rtk tsc
rtk vitest run
pnpm lint
```

Use judgment on scope, but say exactly what was and was not run.

## Git

- Branches: `feature/*`, `fix/*`, `chore/*`.
- Commit format: `type(scope): imperative lowercase message`, max 50 chars.
- Do not commit or push unless explicitly asked.
- Never use destructive git commands against user changes. Inspect
  `rtk git status --short` before editing and before final handoff.

Common scopes: `api`, `map`, `cache`, `geocoder`, `github`, `db`, `ui`, `admin`,
`mcp`, `config`, `deps`, `docs`.

## Product Guardrails

- StarMapper is still no-auth and read-only by default. Auth/user accounts are a
  real product decision, not incidental plumbing.
- Do not build fake placeholders for external services or legal decisions.
- Do not resume the crawler path just because it is technically possible.
- Preserve user trust: if the data is historical, partial, engaged-only, or
  owner-live, the UI and API labels must say that plainly.
