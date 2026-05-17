---
name: "source-command-tech-audit-codebase"
description: "7-category codebase health audit for StarMapper with weighted scoring and tier system. Run before major releases or architectural changes."
---

# source-command-tech-audit-codebase

Use this skill when the user asks to run the migrated source command `tech-audit-codebase`.

## Command Template

# Codebase Audit — StarMapper

Performs a scored health audit across 7 categories. Output: tier assessment, weighted global score, and prioritized action plan.

## Usage

```
/tech:audit-codebase              # Full audit
/tech:audit-codebase --category secrets   # Single category
/tech:audit-codebase --fix        # Audit + auto-fix safe issues
/tech:audit-codebase --json       # JSON output for CI
```

## Scoring System

Each category scored 0–10. Weighted global score:

| Category | Weight | Focus |
|----------|--------|-------|
| Secrets & Tokens | 2x | Env vars, GitHub tokens, API keys in code |
| Security | 2x | XSS, injection, CSP headers |
| Dependencies | 1x | Outdated packages, known CVEs |
| Structure | 1.5x | File naming, import order, conventions |
| Rate Limit Safety | 2x | Nominatim delay, circuit breakers, GitHub limit checks |
| Cache Integrity | 1.5x | GeoCache keys, StargazerCache compression, DB health guards |
| Code Quality | 1x | TypeScript errors, ESLint violations, no-any, no console.log |

**Global score** = `sum(score × weight) / sum(weights)`

## Tier System

| Tier | Score | Status |
|------|-------|--------|
| 🔴 Tier 1 | 0–4 | Critical — block release |
| 🟡 Tier 2 | 5–7 | Improvement required — address within sprint |
| 🟢 Tier 3 | 8–10 | Production ready |

## Phase 1: Secrets & Tokens (weight 2x)

```bash
# Search for hardcoded secrets
grep -r "ghp_\|github_pat_\|token.*=.*['\"][a-zA-Z0-9]\{20,\}" src/ --include="*.ts" --include="*.tsx"
grep -r "jawgmap\|geoapify\|neon\.tech" src/ --include="*.ts" --include="*.tsx" | grep -v "process.env"
grep -r "GITHUB_TOKEN\|JAWGMAP\|GEOAPIFY" src/ --include="*.ts" --include="*.tsx" | grep -v "process.env"
```

Check: All secrets accessed via `process.env.*`, never hardcoded. `.env.local` not committed.

Score: 10 if zero hardcoded secrets. -3 per finding.

## Phase 2: Security (weight 2x)

Check:
- CSP headers present in `next.config.ts`
- No `dangerouslySetInnerHTML` without sanitization
- No `eval()` or dynamic `require()` in API routes
- No raw SQL injection vectors (Prisma parameterizes, check raw queries)
- XSS vectors in popup innerHTML (MapLibre popups use innerHTML — verify escaping)

Score: 10 if clean. -2 per finding.

## Phase 3: Dependencies (weight 1x)

```bash
rtk pnpm outdated
```

Check major outdated deps (Next.js, MapLibre, Prisma). Flag known CVEs if any.

Score: 10 if up-to-date. -1 per major outdated, -3 per CVE.

## Phase 4: Structure (weight 1.5x)

```bash
# Check for function keyword (should be arrow functions only)
grep -rn "^export function\|^  function " src/ --include="*.ts" --include="*.tsx"
# Check for interface (should be type)
grep -rn "^export interface\|^interface " src/ --include="*.ts" --include="*.tsx"
# Check for console.log left in code
grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx"
# Check file naming (should be kebab-case)
find src/ -name "*.tsx" -o -name "*.ts" | grep -E "[A-Z]" | grep -v "\.d\.ts"
```

Score: 10 if clean. -1 per `function` keyword, -0.5 per `interface`, -0.5 per `console.log`.

## Phase 5: Rate Limit Safety (weight 2x) — StarMapper-specific

```bash
# Nominatim calls must have delay
grep -rn "callNominatim\|nominatim\|openstreetmap" src/ --include="*.ts"
# Check for Promise.all on geocoding (forbidden)
grep -rn "Promise.all.*geocod\|geocod.*Promise.all" src/ --include="*.ts"
# GitHub rate limit check
grep -rn "X-RateLimit-Remaining\|rateLimit" src/ --include="*.ts"
```

Check:
- Nominatim calls have 1100ms delay between them (sequential, not parallel)
- Circuit breaker present for Jawg/Geoapify (3 errors → 1h cooldown)
- GitHub GraphQL checks `X-RateLimit-Remaining` before each call
- No `Promise.all()` on Nominatim calls

Score: 10 if all guards present. -3 per missing critical guard.

## Phase 6: Cache Integrity (weight 1.5x) — StarMapper-specific

```bash
# Geocache key normalization
grep -rn "toLowerCase.*trim\|trim.*toLowerCase" src/lib/geocoder.ts
# DB health guard on writes
grep -rn "checkDbHealth\|dbHealth" src/lib/user-cache.ts
# Compression before large cache writes
grep -rn "pointsGz\|CompressionStream\|gzip" src/app/\[owner\]/\[repo\]/page.tsx 2>/dev/null || grep -rn "pointsGz\|CompressionStream\|gzip" src/app/ --include="*.tsx"
```

Check:
- GeoCache key always `location.toLowerCase().trim()`
- `checkDbHealth()` called before user-level cache writes
- StargazerCache write uses compressed format (`pointsGz`, `unmappedGz`)

Score: 10 if all patterns correct. -3 per missing guard.

## Phase 7: Code Quality (weight 1x)

```bash
rtk tsc
pnpm lint
```

Score: 10 if zero errors. -1 per TypeScript error, -0.5 per ESLint error.

## Output Format

```
## StarMapper Codebase Audit

**Date**: {date}
**Global Score**: {score}/10 — {Tier 🔴/🟡/🟢}

| Category | Score | Weight | Notes |
|----------|-------|--------|-------|
| Secrets & Tokens | X/10 | 2x | ... |
| Security | X/10 | 2x | ... |
| Dependencies | X/10 | 1x | ... |
| Structure | X/10 | 1.5x | ... |
| Rate Limit Safety | X/10 | 2x | ... |
| Cache Integrity | X/10 | 1.5x | ... |
| Code Quality | X/10 | 1x | ... |

## Critical Issues (block release)
[List of Tier 1 findings]

## Action Plan
### Quick Wins (< 1h)
1. ...

### This Sprint (2-4h)
2. ...

### Backlog
3. ...
```
