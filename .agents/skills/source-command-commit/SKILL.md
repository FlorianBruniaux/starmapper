---
name: "source-command-commit"
description: "Conventional commit with StarMapper scope auto-detection"
---

# source-command-commit

Use this skill when the user asks to run the migrated source command `commit`.

## Command Template

# Commit

Create a conventional commit following StarMapper conventions.

## Steps

1. `rtk git status` + `rtk git diff` — understand what changed
2. Detect scope from files:
   - `components/map/` → `map`
   - `app/api/chunk/` → `api`
   - `app/api/repo-info/` → `api`
   - `lib/geocoder.ts` → `geocoder`
   - `lib/github.ts` → `github`
   - `lib/db.ts` or `prisma/` → `db`
   - `app/page.tsx` or `app/[owner]/[repo]/page.tsx` → `ui`
   - `next.config`, `tsconfig`, `.Codex/`, `.env.example` → `config`
   - `package.json`, `pnpm-lock.yaml` → `deps`
3. **Scope Check** avant de stager :
   - Chaque fichier stagé est directement lié au changement en cours
   - Pas de "refactoring opportuniste" non demandé
   - Si un fichier n'est pas directement lié → commiter séparément
4. Stage specific files (never `git add -A`)
5. Commit with HEREDOC:

```bash
git commit -m "$(cat <<'EOF'
type(scope): imperative lowercase message

[Optional body: explain WHY, not what]

Co-Authored-By: Codex Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

6. `rtk git status` to verify

## Types

- `feat` — new feature or capability
- `fix` — bug fix
- `perf` — performance improvement
- `refactor` — restructure without behavior change
- `chore` — deps, config, tooling
- `docs` — documentation only

## Examples

```
feat(map): add unmapped users drawer
fix(db): add url to datasource in schema.prisma
perf(geocoder): cache null results to skip re-geocoding
chore(deps): upgrade maplibre-gl to 5.21
fix(api): handle github graphql 429 rate limit
refactor(github): remove null cursor from graphql variables
feat(ui): add star count progress bar
fix(geocoder): normalize location key before cache lookup
```

## Rules

- **Granularity** : commiter APRÈS chaque changement logique terminé, pas tout à la fin
- Never stage `.env.local`, `.env*`, or any secrets
- Specify files explicitly — no `git add .`
- Message: imperative, lowercase, max 50 chars
- Body optional but valuable for non-obvious changes
