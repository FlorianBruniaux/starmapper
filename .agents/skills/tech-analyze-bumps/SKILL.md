---
name: tech-analyze-bumps
description: Analyze Dependabot PRs and generate risk-based merge plan with priority order
version: 1.0.0
effort: medium
allowed-tools: [Bash, Read]
tags: [dependabot, dependencies, security, semver, merge-plan]
---

# Tech: Analyze Dependabot Bumps

Automates analysis of Dependabot PRs to generate a risk-categorized merge plan.

## When to Use This Skill

- Weekly Dependabot PR review
- Before deploying to Vercel prod
- When multiple dependency updates accumulate
- To prioritize which PRs to merge first

## What This Skill Does

1. **Fetch PRs**: Uses `gh pr list` to get all open Dependabot PRs on `FlorianBruniaux/starmapper`
2. **Analyze Each PR**:
   - Parses version bump (major/minor/patch via semver)
   - Identifies dependency type (deps vs devDeps from `package.json`)
   - Checks CI status (passed/failed)
3. **Risk Categorization**:
   - 🟢 LOW: devDeps minor bumps (TypeScript, ESLint, Prettier, Vitest)
   - 🟡 MEDIUM: deps minor bumps (Next.js minor, Tailwind, Prisma client)
   - 🔴 HIGH: Major version bumps (MapLibre GL, Next.js major, Prisma major)
   - 🚨 CRITICAL: Neon adapter + Prisma pair mismatches (runtime crash risk)
4. **Generate Merge Plan**: Sequential phases with verification commands

## How to Use

### Basic Usage

```
/tech-analyze-bumps
```

This will:

- Scan all open Dependabot PRs on `FlorianBruniaux/starmapper`
- Run `scripts/analyze_bumps.py` to generate the report
- Output risk-categorized markdown with merge plan

### Output Example

```markdown
## 📊 Dependabot Bump Analysis

### 🟢 LOW RISK (3 PRs)

- #42: typescript 5.4.0 → 5.5.2 (devDep minor)
- #41: eslint 9.1.0 → 9.3.0 (devDep minor)

### 🟡 MEDIUM RISK (2 PRs)

- #45: next 15.1.0 → 15.2.0 (dep minor)
- #44: tailwindcss 4.0.0 → 4.1.0 (dep minor)

### 🔴 HIGH RISK (1 PR - Breaking Changes)

- #47: maplibre-gl 4.7.0 → 5.0.0 (major — MapLibre visual regression risk)

### 🚨 CRITICAL (1 PR - Neon adapter sync)

- #48: @prisma/adapter-neon 7.0.0 → 7.1.0 without prisma 7.1.0 → mismatch risk

## 🎯 Merge Plan

### Phase 1: DevDeps (LOW)

1. Merge #42, #41
2. Run: `rtk tsc && pnpm lint`

### Phase 2: Runtime Minor (MEDIUM)

3. Merge #45 (check Vercel build)
4. Merge #44 (verify Tailwind v4 theme tokens)

### Phase 3: Major Bumps (HIGH)

5. Create branch `chore/maplibre-v5-bump`
6. Merge #47, test map rendering + cluster interactions

### Phase 4: Critical (Prisma sync)

7. Merge Prisma + adapter pair together
8. Run `npx prisma generate && rtk tsc`
```

## Risk Classification Rules (StarMapper-specific)

### 🟢 LOW RISK

- **Criteria**: devDeps AND minor/patch bump
- **Examples**: TypeScript, ESLint, Prettier, Vitest, `@types/*`
- **Action**: Merge all at once, `rtk tsc` check

### 🟡 MEDIUM RISK

- **Criteria**: Runtime deps AND minor bump
- **Examples**: Next.js minor, Tailwind v4 minor, Zod minor
- **Action**: Merge individually, verify build on localhost

### 🔴 HIGH RISK

- **Criteria**: Major version bump
- **Categories**:
  - **MapLibre GL**: API breaking changes (check `getClusterExpansionZoom` Promise API, layer paint properties)
  - **Next.js major**: App Router breaking changes, middleware changes
  - **Prisma major**: Schema model changes, adapter API changes
  - **Neon adapter**: Connection pooling API changes
- **Action**: Create `chore/<name>-bump` branch, test locally before PR

### 🚨 CRITICAL

- **Criteria**: Prisma + @prisma/adapter-neon version mismatch, OR major bump to either
- **Why**: Mismatched versions cause silent runtime crashes on Vercel (no build error, fails at query time)
- **Action**: Always merge `prisma` + `@prisma/adapter-neon` together in the same commit

## CI Failure Detection

If ALL PRs have failing checks:

```markdown
⚠️ OBSERVATION CRITIQUE

TOUTES les PRs ont des checks qui échouent (X/Y failed).
Cela indique probablement :

- Problème TypeScript global (rtk tsc pour diagnostiquer)
- Conflit de versions entre dépendances
- Build Next.js cassé

AUCUNE PR ne peut être mergée sans risque dans l'état actuel.
```

**Action**: `rtk tsc` en local pour diagnostiquer avant de merger quoi que ce soit.

## Verification Commands

After each merge phase:

```bash
# Type check (always first)
rtk tsc

# Lint
pnpm lint

# Unit tests
pnpm test

# Prisma regeneration (if Prisma or adapter bumped)
npx prisma generate
rtk tsc  # Re-verify after generate

# Visual check (MapLibre or UI deps)
pnpm dev  # Open localhost:3000, test map + cluster + popups
```

## Special Cases (StarMapper)

### Prisma + Neon Adapter Sync

- **Always merge together**: `prisma` (devDep) + `@prisma/adapter-neon` (dep)
- **Reason**: Version mismatch → runtime crash at first Prisma query (no build error)
- **Detection**: Both PRs present → flag as "must sync"
- **Post-merge**: `npx prisma generate && rtk tsc`

### MapLibre GL Major

- **Risk**: Breaking changes in cluster API (v4→v5 made `getClusterExpansionZoom` Promise-based)
- **Action**: Create branch `chore/maplibre-vX-bump`, test:
  1. Map renders correctly
  2. Cluster click → expansion zoom works
  3. Popup opens with correct stargazer data
  4. 2D/3D toggle works (globe projection)

### Next.js Major

- **Risk**: App Router, Server Actions, middleware API changes
- **Action**: Read migration guide, test chunk loop end-to-end (small repo < 100 stars)

## Example Workflow

```bash
# Weekly review
/tech-analyze-bumps

# Phase 1: Merge LOW (devDeps)
gh pr merge 42 --squash
gh pr merge 41 --squash
rtk tsc  # ✅ Pass

# Phase 2: MEDIUM individually
gh pr merge 45 --squash
pnpm build  # ✅ Next.js build OK

# Phase 3: HIGH (MapLibre)
git checkout -b chore/maplibre-v5-bump
gh pr checkout 47
pnpm dev
# Test: map renders, clusters work, popups open → ✅

# Phase 4: CRITICAL (Prisma sync)
gh pr merge 48 --squash  # Merge adapter + prisma together
npx prisma generate
rtk tsc  # ✅ 0 errors
```

## Tips

- **Run weekly**: Monday mornings
- **Batch LOW**: Merge all devDeps minor bumps at once
- **Never batch MEDIUM**: Runtime deps individually (easier rollback)
- **Branch for HIGH**: Never merge major bumps directly to main
- **Prisma sync**: Non-negotiable — always pair the two together
