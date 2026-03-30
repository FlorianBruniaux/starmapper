---
name: codereview
description: Pre-PR code review for StarMapper. Analyzes recent changes for quality, security, performance, and StarMapper-specific patterns. Supports auto-fix loop and multi-agent modes.
model: sonnet
tools: Read, Grep, Glob, Bash, Write, Edit
---

# Code Review — StarMapper

Pre-PR local review analyzing recent changes against StarMapper conventions.

## Usage

```
/tech:codereview              # Standard review of staged/recent changes
/tech:codereview --auto       # Review + auto-fix loop (max 3 iterations)
/tech:codereview --multi-agent # 4 parallel agents (comprehensive)
/tech:codereview --focus security   # Single dimension
/tech:codereview --focus performance
/tech:codereview --focus types
```

## Step 1: Get context

```bash
rtk git diff --staged
rtk git diff HEAD~1
rtk git status
```

Identify: which files changed, what kind of change (API route, component, lib, schema).

## Step 2: Conditionally load guides

- `.ts`/`.tsx` files → apply `code-conventions.md` rules
- `src/components/**` → apply `design-system.md` + `react-ref-patterns.md`
- `src/lib/geocoder*` → apply `defensive-code-audit.md` + rate limit rules
- `src/app/api/**` → apply API route conventions from `architecture.md`
- `prisma/schema.prisma` → apply Prisma + Neon adapter pattern rules
- `src/components/map/**` → apply MapLibre GL 5.x patterns

## Step 3: Analyze (3 severity levels)

### 🔴 Blocking (must fix before merge)
- Hardcoded tokens, secrets, or API keys
- GitHub token exposed in client bundle
- XSS vector in MapLibre popup innerHTML
- `function` keyword instead of arrow function
- `any` type without justification
- Nominatim called in parallel (rate ban risk)
- Server-side loop over all stargazers (Vercel 10s limit)
- Raw JSON payload for large repos (4.5MB limit)
- Missing `ssr: false` on MapLibre dynamic import
- Prisma write without try/catch

### 🟡 Important (should fix, non-blocking)
- Missing `import type` for type-only imports
- Arbitrary Tailwind values (`w-[Npx]`, `bg-[#xxx]`)
- `console.log` left in code
- Missing DB health guard on new cache writes
- `forEach` with `async` callback
- Geocache key not normalized (`toLowerCase().trim()`)
- Silent catch (error swallowed, no response returned)
- `cursor: null` passed as GraphQL variable

### 🟢 Suggestions (optional improvements)
- `memo()` opportunity on component that re-renders frequently
- `useMemo()` for GeoJSON feature array construction
- `Promise.all()` for independent async operations
- Unused imports

## Step 4: Report

```
## Code Review — StarMapper

**Files reviewed**: [list]
**Change type**: [API route / component / lib / schema]

### 🔴 Blocking Issues (N)
1. **[Category]**: [Description]
   File: `src/...` line N
   Fix: [concrete fix]

### 🟡 Important Issues (N)
1. **[Category]**: [Description]
   File: `src/...` line N
   Suggestion: [concrete improvement]

### 🟢 Suggestions (N)
1. ...

### ✅ Patterns Verified
- [ ] Arrow functions only
- [ ] Type imports separate
- [ ] No any
- [ ] CSS tokens used (no arbitrary values)
- [ ] MapLibre ssr:false
- [ ] Geocache key normalized
- [ ] Rate limit guards present
- [ ] No console.log
```

## Mode: --auto

Iterative fix loop (max 3 iterations):
1. Run review → identify blocking + important issues
2. Apply fixes one by one
3. Re-run `rtk tsc` + `pnpm lint` after each batch
4. Stop when: zero blocking + zero important issues OR 3 iterations reached
5. Output summary: what was fixed, what remains

**Safety**: Never edit `.env*` files. Confirm before modifying > 5 files.

## Mode: --multi-agent

Launch 4 parallel specialized agents and reconcile results:

**Agent 1 — Architecture & Chunk Pattern Auditor**
- Verifies chunk loop integrity (no server-side loops)
- Checks Vercel constraint compliance (10s, 4.5MB)
- Reviews cache strategy (geocache, stargazer cache, badge cache)

**Agent 2 — StarMapper Patterns Enforcer**
- TypeScript conventions (arrow functions, type imports, no any)
- Tailwind v4 design system compliance (tokens, no arbitrary values)
- MapLibre GL 5.x patterns (Promise-based API, ssr:false, cleanup)
- Geocoder patterns (normalized key, cache-first, sequential)

**Agent 3 — Performance & Rate Limit Auditor**
- GitHub GraphQL rate limit handling
- Nominatim: sequential calls, 1100ms delay
- Circuit breaker presence for Jawg/Geoapify
- MapLibre render performance (memo, useMemo)
- Bundle size implications

**Agent 4 — Defensive Code Auditor**
- No silent catches in API routes
- No `|| {}` on Prisma returns
- No `forEach` with `async`
- DB health guard on writes
- XSS in MapLibre popups

**Reconciliation**:
- Deduplicate findings across agents
- Merge into unified report with severity
- Highlight consensus findings (flagged by 2+ agents)
