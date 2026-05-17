---
name: "source-command-tech-dupes"
description: "Code duplication analysis for StarMapper using jscpd. Detects repeated patterns across geocoding helpers, GitHub API formatting, compression utils, and cache logic."
---

# source-command-tech-dupes

Use this skill when the user asks to run the migrated source command `tech-dupes`.

## Command Template

# Code Duplication Detector — StarMapper

## Usage

```
/tech:dupes
```

## What It Does

1. Runs `pnpm dupes` (jscpd) on the `src/` directory
2. Analyzes results against StarMapper-specific patterns
3. Outputs structured report with action plan

## Setup Check

If `pnpm dupes` is not configured, add to package.json:
```json
"dupes": "jscpd src/ --threshold 3 --min-lines 5 --reporters console,json --output .dupes-report"
```

And install: `pnpm add -D jscpd`

## StarMapper Duplication Patterns to Watch

| Pattern | Location | Risk |
|---------|----------|------|
| `location.toLowerCase().trim()` | geocoder, routes | Should exist ONLY in geocoder.ts |
| GitHub error parsing | github.ts, chunk/route.ts | Extract to github.ts |
| Compression/decompression logic | page.tsx, cache routes | Extract to lib/compression.ts |
| `checkDbHealth()` call pattern | user-cache, cache routes | OK if identical — it's a guard |
| `NextResponse.json({ error: ... })` patterns | all routes | Accept duplication here |
| `cursor ? { cursor } : {}` | github.ts | Should only be in github.ts |

## Thresholds

| Metric | Target | Action |
|--------|--------|--------|
| Duplication % | < 3% | Above → refactor |
| Clone count | < 10 | Above → prioritize |
| Max clone size | < 25 lines | Above → extract function |

## Output Format

```
## Duplication Report — StarMapper

**Date**: {date}
**Duplication**: X% ({target: < 3%})
**Clones found**: N

### Top Clones
1. [file:line] ↔ [file:line] — {N} lines
   Pattern: {brief description}
   Action: {extract to / delete duplicate}

### Action Plan
#### Quick Wins (< 30min)
1. ...

#### Refactoring (1-2h)
2. ...

#### Prevention
- Add `pnpm dupes` to CI check
```
