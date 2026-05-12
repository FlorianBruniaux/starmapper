# Code Duplication Detection (Auto-loaded)

## DRY Principle

**Golden Rule**: If a function exists in 2+ places with the same logic → refactor immediately.

---

## Detection Triggers

### CRITICAL: Identical Function Signatures

```typescript
// 🚨 RED FLAG: same function in multiple files
// src/lib/geocoder.ts
export const normalizeLocation = (loc: string) => loc.toLowerCase().trim();

// src/app/api/chunk/route.ts
export const normalizeLocation = (loc: string) => loc.toLowerCase().trim(); // ❌ duplicate
```

**Action**: Centralize in `src/lib/` and import everywhere.

---

### HIGH: Similar Logic with Minor Variations

Same algorithm with small differences → extract with parameters.

---

## Refactoring Workflow

1. **Identify**: `git grep "export const myFunction"` before writing code
2. **Decide the location**:
   - Pure utility → `src/lib/`
   - Business logic → `src/lib/[domain]/`
3. **Create Single Source of Truth** with JSDoc
4. **Refactor**: import from the centralized file
5. **Verify**: `rtk tsc` then tests

---

## Location by Type (StarMapper)

| Type | Location | Example |
|------|----------|---------|
| Geocoding helpers | `src/lib/geocoder.ts` | location normalization |
| GitHub API helpers | `src/lib/github.ts` | GraphQL response formatting |
| Shared types | export from `route.ts` | `StargazerPoint`, `UnmappedUser` |
| Constants | `src/lib/constants.ts` | rate limit thresholds |

---

## Anti-Patterns

| ❌ | ✅ |
|----|-----|
| "There are only 2 occurrences, it's fine" | Fix immediately — 2 becomes 3 |
| Copy-paste + change 1 line | Extract + parameterize the difference |
| Variations without justification | Standardize on a single variant |

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.