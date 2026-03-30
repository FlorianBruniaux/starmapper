# Test Strategy — StarMapper

**Date**: 2026-03-30
**Status**: Initial implementation complete

---

## Part 1: Strategy

### 1. Test Runner Choice — Vitest

Vitest is the right pick for this stack, for concrete reasons:

- **Same config as Vite/Next.js**: `moduleResolution: bundler`, `@/*` path aliases, and ESM modules all work out of the box via `vitest.config.ts`. Jest requires a custom `jest.config.js` + `babel-jest` or `ts-jest` to handle those same things — more moving parts, slower startup.
- **Native TypeScript**: No transform step. Vitest runs `.ts` files directly.
- **Global API compatible**: `describe/it/expect` are available without imports (`globals: true`), matching the Next.js testing documentation style.
- **Performance**: Vitest uses Vite's module graph for faster hot module replacement in watch mode. On this codebase (small-to-medium), test startup is under 1 second.
- **`vi.mock()` works like Jest's `jest.mock()`**: Same hoisting semantics, same factory pattern — teams familiar with Jest adapt in minutes.

### 2. What to Test vs. What to Skip

**Test these (high ROI, pure logic, mockable):**

| File | Reason |
|------|--------|
| `src/lib/geocoder.ts` | Complex 3-tier cascade, circuit breakers, cache normalization — lots of branching logic that is invisible without tests |
| `src/lib/github.ts` | Cursor pagination, rate limit error parsing, `since` boundary logic — bugs here break every scan |
| `src/lib/countries.ts` | Pure functions with a large lookup table — trivial to test, high confidence value |
| `src/lib/user-cache.ts` | DB health guard controls whether data is persisted at all — critical to get right |
| `src/app/api/chunk/route.ts` | Main orchestration endpoint — input validation, error codes, geocoding integration |
| `src/app/api/stargazer-cache/route.ts` (POST) | Compression format branching, totalCount validation |
| `src/app/api/stargazer-cache/[owner]/[repo]/route.ts` (GET) | Cache hit/miss/206 status branching |

**Skip these (not practical without a browser or full integration environment):**

| File | Reason |
|------|--------|
| `src/components/map/stargazer-map.tsx` | MapLibre GL requires a real DOM with WebGL. Even with jsdom, `maplibregl.Map` constructor throws without canvas support. Test visually or with Playwright. |
| `src/components/theme-toggle.tsx` | Pure UI, no logic — visual regression test territory |
| `src/lib/theme.ts` | `localStorage` is browser-only; jsdom would work but the value is marginal |
| `src/lib/bookmarks.ts` | Same: browser localStorage, no business logic worth unit testing |
| `src/app/[owner]/[repo]/page.tsx` | Next.js server component + client chunk loop — integration/E2E territory |

### 3. Test Layers

**Unit tests (what this doc implements)** — 80% of the test investment

The app's critical logic is concentrated in `src/lib/` and `src/app/api/`. These are pure TypeScript functions with well-defined inputs and outputs. Mock Prisma and `fetch`, test the logic. Fast, no network, runs in CI in under 10 seconds.

**Integration tests** — 15% — future work

Worth adding once the unit layer is solid:
- `GET /api/stargazer-cache/[owner]/[repo]` against a real Neon branch (Neon offers branching for test isolation)
- `POST /api/badge-update` end-to-end
- Geocache pre-seeding scripts (`seed-geocache-geonames.ts`)

These require a `DATABASE_URL` pointing at a test branch and should run in a separate CI job, not on every push.

**E2E tests (Playwright)** — 5% — future work

Two flows worth automating:
1. Enter a small repo URL (< 50 stars) → map renders with at least one point
2. Re-visit the same repo → "loaded from cache" path is taken (no chunk loop)

Playwright can run headless in CI against `vercel preview` URLs. Skip until there is a stable staging deployment.

### 4. Mocking Strategy

**Prisma**

Mock at the `@/lib/db` module level with `vi.mock()`. The `prisma` export is replaced with a plain object whose methods are `vi.fn()`. This is the correct layer — `db.ts` is a singleton that wraps the Neon adapter, which requires real network. Never try to mock the adapter; mock the client.

```typescript
vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
```

Vitest hoists `vi.mock()` calls to the top of the file (same as Jest), so the mock is active before the tested module imports `@/lib/db`.

**GitHub API (fetch)**

Spy on `global.fetch` with `vi.spyOn`. Return `new Response(JSON.stringify(...), { status: 200 })`. This is more realistic than string mocks because `Response` is the actual Web API type that `github.ts` receives. Reset with `vi.restoreAllMocks()` in `afterEach`.

**Nominatim / Jawg / Geoapify**

Same `vi.spyOn(global, "fetch")` approach. Chain `.mockResolvedValueOnce()` to simulate the provider cascade (Jawg error → Geoapify response, etc.). The order matters and must match the cascade order in `_resolveAndCache`.

**Environment variables**

Use `vi.stubEnv("JAWGMAP_ACCESS_TOKEN", "test_token")` / `vi.unstubAllEnvs()`. Never hardcode real tokens in tests. `stubEnv` is fully reversible via `unstubAllEnvs()` and does not pollute other tests.

**DB Health**

Mock `@/lib/db-health` entirely. The default in tests should be `{ ok: true, usagePct: 10 }` — healthy DB, well under the critical threshold. Add specific test cases for `{ ok: false }` and `usagePct: 96` to verify the guard logic.

### 5. Priority Order — 5 Files That Give the Most Confidence

1. **`src/lib/__tests__/geocoder.test.ts`** — The geocoding cascade is the highest-complexity piece of logic in the entire app. A bug here silently maps users to wrong locations or wastes API quota. The circuit breaker state is in-memory and easy to get wrong.

2. **`src/app/api/chunk/__tests__/route.test.ts`** — This is the hot path for every scan. Every user who visits a repo page goes through this endpoint. Input validation, error codes, and the points/unmapped split all need coverage.

3. **`src/lib/__tests__/github.test.ts`** — Cursor handling bugs break pagination silently (you get partial results with no error). Rate limit handling is safety-critical for apps used at scale.

4. **`src/lib/__tests__/countries.test.ts`** — The alias map and normalization are pure functions with clear expected outputs. Fast wins with zero mocking overhead, and bugs here cause wrong country labels on the stats panel.

5. **`src/lib/__tests__/user-cache.test.ts`** (not yet written) — The DB health guard is the mechanism that prevents Neon storage overflow. If `bulkUpsertUsers` writes when it should not, the 512MB free tier overflows and the entire app goes down. High consequence, easy to test with a mocked health result.

---

## Part 2: Test Files Written

- `src/lib/__tests__/countries.test.ts` — 22 tests, pure logic, no mocks needed
- `src/lib/__tests__/github.test.ts` — 17 tests, `fetch` mocked via `vi.spyOn`
- `src/lib/__tests__/geocoder.test.ts` — 21 tests, Prisma + `fetch` mocked
- `src/app/api/chunk/__tests__/route.test.ts` — 20 tests, all dependencies mocked

---

## Part 3: Setup

### Install

```bash
pnpm add -D vitest @vitest/coverage-v8
```

Already done. Both packages are now in `devDependencies`.

### vitest.config.ts

Located at the project root. Key decisions:
- `environment: "node"` — API routes and lib functions run in Node, not a browser. No jsdom overhead.
- `pool: "forks"` — Runs each test file in its own Node process. Required because `geocoder.ts` uses module-level circuit breaker state (`jawgErrorCount`, `geoapifyErrorCount`). Without process isolation, a test that triggers the circuit breaker in one file poisons the next file.
- `@/*` alias resolves to `./src/*`, matching `tsconfig.json`.

### package.json scripts added

```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage"
```

### Running the tests

```bash
# Run once (CI)
pnpm test

# Watch mode (development)
pnpm test:watch

# With coverage report (generates HTML in coverage/)
pnpm test:coverage

# Run a single file
pnpm vitest run src/lib/__tests__/geocoder.test.ts

# RTK-optimized (failures only, ~99% token reduction in CI logs)
rtk vitest run
```

### Next.js-specific notes

The test config does **not** use `@vitejs/plugin-react` because the tested files (`src/lib/`, `src/app/api/`) are all Node-side TypeScript with no JSX. If you add React component tests in the future, add the plugin and switch `environment` to `happy-dom` for those files.

The `next/server` imports (`NextRequest`, `NextResponse`) work in Vitest's Node environment because Next.js 16 ships these as standard Web API polyfills, not browser-only code.

### CI integration (GitHub Actions)

```yaml
# .github/workflows/ci.yml
- name: Test
  run: pnpm test
  env:
    # No real tokens needed — all external calls are mocked
    GITHUB_TOKEN: ""
    JAWGMAP_ACCESS_TOKEN: ""
    GEOAPIFY_APIKEY: ""
    DATABASE_URL: ""
```

No database, no API keys required for the unit tests. The mocks handle everything.
