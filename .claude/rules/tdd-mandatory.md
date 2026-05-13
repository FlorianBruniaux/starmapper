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

## What to Skip (not practical without a browser)

| File | Reason |
|------|--------|
| `src/components/map/stargazer-map.tsx` | MapLibre GL requires WebGL — jsdom can't provide it. Test with Playwright. |
| `src/components/theme-toggle.tsx` | Pure UI, no logic |
| `src/lib/theme.ts` | browser-only localStorage, marginal value to unit test |
| `src/lib/bookmarks.ts` | Same: browser localStorage, no business logic |
| `src/app/[owner]/[repo]/page.tsx` | Server component + client chunk loop — integration/E2E territory |

---

## Mocking Strategy

**Prisma** — mock at `@/lib/db` module level:
```typescript
vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
```

**GitHub API / external fetch** — spy on `global.fetch`:
```typescript
vi.spyOn(global, "fetch").mockResolvedValueOnce(
  new Response(JSON.stringify(...), { status: 200 })
);
// Reset in afterEach:
vi.restoreAllMocks();
```

**Provider cascade** — chain `.mockResolvedValueOnce()` in cascade order (Jawg error → Geoapify response...).

**Env vars** — `vi.stubEnv("KEY", "value")` / `vi.unstubAllEnvs()` in afterEach.

**DB Health** — mock `@/lib/db-health` entirely. Default: `{ ok: true, usagePct: 10 }`. Add specific cases for `{ ok: false }` and `usagePct: 96`.

---

## Vitest Config Notes

- `environment: "node"` — API routes and lib functions run in Node, not a browser
- `pool: "forks"` — **required**: `geocoder.ts` has module-level circuit breaker state (`jawgErrorCount`). Without process isolation, a test triggering the breaker in one file poisons the next file.
- `@/*` alias resolves to `./src/*` matching `tsconfig.json`

```bash
pnpm test           # run all tests
pnpm test:watch     # watch mode
pnpm test:coverage  # coverage report
rtk vitest run      # CI — failures only (~99% token reduction)
```

---

## Coverage Status

| Milestone | Target | Status |
|-----------|--------|--------|
| **Baseline** | 0% | ✅ Done (before OSS audit) |
| **Phase 1** | 15% | ✅ Done — 313 tests: geocoder, github, countries, chunk route |
| **Phase 2** | 30% | 🔲 Next — stargazer-cache, user-cache, countries edge cases |
| **Phase 3** | 60% | 🔲 Future — full lib/, important routes |

---

## Exceptions (ask user first)

- One-shot scripts (`scripts/`)
- Config files
- Generated code (Prisma client)
- Page layout components with no business logic

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
