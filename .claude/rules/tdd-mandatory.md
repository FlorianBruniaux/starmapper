# TDD — Test-Driven Development (Auto-loaded)

## Directive

**All new code in `src/lib/` and `src/app/api/` MUST be accompanied by a test.**

StarMapper is currently at 0% coverage. The goal is not to enforce dogmatic TDD on legacy code, but to stop making things worse and build coverage progressively.

---

## Red-Green-Refactor Workflow

```
1. RED    → Write the failing test
2. VERIFY → Run the test, confirm it fails for the right reason
3. GREEN  → Write the minimum code to pass
4. VERIFY → Run the test, confirm it passes
5. REFACTOR → Clean up (test stays green)
```

---

## Rules by Area

### New code (TDD MANDATORY)

| Area | Test type | Priority |
|------|-----------|----------|
| `src/lib/geocoder.ts` | Unit — cache hit/miss, cascade fallback, null result | CRITICAL |
| `src/lib/github.ts` | Unit — cursor handling, rate limit response | HIGH |
| `src/lib/user-cache.ts` | Unit — DB health guard, skip on overflow | HIGH |
| `src/app/api/chunk/route.ts` | Integration — full chunk processing | HIGH |
| `src/app/api/stargazer-cache/` | Integration — compression/decompression | MEDIUM |
| `src/lib/countries.ts` | Unit — normalizeCountry | LOW |

### Existing code (TDD strongly recommended)

- Modifying an existing function without a test → add the test at the same time
- Small fix to existing code → tests optional but encouraged
- Do not block on missing tests for non-critical legacy code (UI, page layout)

---

## StarMapper Examples

### Good test (geocoder)

```typescript
// src/lib/geocoder.test.ts
test("geocode() returns null for an empty location", async () => {
  const result = await geocode("");
  expect(result).toBeNull();
});

test("geocode() cache hit — does not call Nominatim", async () => {
  const spy = vi.spyOn(nominatim, "call");
  // Seed the cache with "Paris" → { lat: 48.85, lng: 2.35 }
  await geocode("Paris");
  expect(spy).not.toHaveBeenCalled();
});
```

### Bad test (too vague)

```typescript
test("geocoder works", async () => {
  const result = await geocode("Paris");
  expect(result).toBeDefined(); // ❌ too vague
});
```

---

## Vitest Setup

StarMapper uses Vitest. Tests live alongside source files or in `src/__tests__/`.

```bash
pnpm test           # run all tests
pnpm test:watch     # watch mode
pnpm test:coverage  # coverage report
```

---

## Coverage Roadmap

| Milestone | Target | Focus |
|-----------|--------|-------|
| **Current** | ~0% | Baseline |
| **Phase 1** | 15% | geocoder.ts, github.ts, user-cache.ts |
| **Phase 2** | 30% | Critical API routes (chunk, stargazer-cache) |
| **Phase 3** | 60% | Full lib/, important routes |

---

## Exceptions (ask user first)

- One-shot scripts (`scripts/`)
- Config files
- Generated code (Prisma client)
- Page layout components with no business logic

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
