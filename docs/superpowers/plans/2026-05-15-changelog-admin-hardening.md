# Changelog & Admin Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce attack surface from the public changelog and harden admin endpoint auth responses to mask endpoint existence.

**Architecture:** Two independent changes — (1) `requireAdminAuth` in `src/lib/api-helpers.ts` returns 404 instead of 401/403 so probing reveals nothing, (2) `CHANGELOG.md` Security/Internal entries are redacted to product-level language that reveals no implementation mechanics.

**Tech Stack:** Next.js App Router, TypeScript, Vitest

---

## Context — What already works

- `requireAdminAuth` exists in `src/lib/api-helpers.ts:32` and is used in all 6 admin routes
- Without `ADMIN_SECRET` env var, the guard is already fail-closed (returns 401)
- `clear-geocache` and `import-geocache` are also blocked with a 404 in production via `NODE_ENV` check
- The issue: 401/403 responses tell an attacker "this endpoint exists and is protected" — 404 tells them nothing

---

## File Map

| File | Change |
|------|--------|
| `src/lib/api-helpers.ts` | Return 404 (not 401/403) in `requireAdminAuth` |
| `src/app/api/admin/clear-geocache/__tests__/route.test.ts` | Update mock + assertion: 401 → 404 |
| `src/app/api/admin/import-geocache/__tests__/route.test.ts` | Update mock + assertion: 401 → 404 |
| `src/app/api/admin/refresh-grid-mv/__tests__/route.test.ts` | Update mock + assertions: 401 → 404 |
| `src/app/api/admin/cleanup/__tests__/route.test.ts` | Update mock + assertions: 401 → 404 |
| `src/app/api/admin/organic-score-stats/__tests__/route.test.ts` | Update mock + assertion: 401 → 404 |
| `src/app/api/admin/delete-user/__tests__/route.test.ts` | Update mock + assertion: 401 → 404 |
| `CHANGELOG.md` | Redact all Security/Internal sections — keep product-level language only |

---

## Task 1: Harden `requireAdminAuth` to return 404

**Files:**
- Modify: `src/lib/api-helpers.ts:32-51`

The goal: an unauthenticated request to any admin endpoint gets 404 — same as a non-existent route. An attacker cannot distinguish "wrong secret" from "endpoint doesn't exist".

- [ ] **Step 1: Read the current implementation**

```bash
# Verify lines 32-51 of api-helpers.ts before editing
```

Open `src/lib/api-helpers.ts` and locate the `requireAdminAuth` function (lines 32–51).

- [ ] **Step 2: Replace 401/403 responses with 404**

Current code in `src/lib/api-helpers.ts`:
```ts
export const requireAdminAuth = (req: NextRequest): NextResponse | null => {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS;
  if (allowedIPs) {
    const ip = getIP(req);
    const allowed = allowedIPs.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(ip)) {
      logAdminAudit(req, "denied_ip");
      return jsonError("Forbidden", 403);      // ← exposes endpoint existence
    }
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-admin-secret") ?? "", secret)) {
    logAdminAudit(req, "denied_secret");
    return jsonError("Unauthorized", 401);     // ← exposes endpoint existence
  }

  logAdminAudit(req, "allowed");
  return null;
};
```

Replace with:
```ts
export const requireAdminAuth = (req: NextRequest): NextResponse | null => {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS;
  if (allowedIPs) {
    const ip = getIP(req);
    const allowed = allowedIPs.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(ip)) {
      logAdminAudit(req, "denied_ip");
      return jsonError("not_found", 404);
    }
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-admin-secret") ?? "", secret)) {
    logAdminAudit(req, "denied_secret");
    return jsonError("not_found", 404);
  }

  logAdminAudit(req, "allowed");
  return null;
};
```

Note: the audit log still records `denied_ip` / `denied_secret` internally — this is for your Vercel logs, not exposed to the caller.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
rtk tsc
```

Expected: 0 errors. If errors appear, check the `jsonError` call signature hasn't changed.

- [ ] **Step 4: Commit this change alone**

```bash
git add src/lib/api-helpers.ts
git commit -m "fix(admin): return 404 instead of 401/403 on auth failure to mask endpoint existence"
```

---

## Task 2: Update all admin route tests (6 files)

The tests mock `requireAdminAuth` to return a `Response` with a specific status. They also assert on that status. Both the mock setup and the assertion need updating in each file. The route code itself hasn't changed — it just passes through whatever `requireAdminAuth` returns.

**Files:**
- Modify: `src/app/api/admin/clear-geocache/__tests__/route.test.ts`
- Modify: `src/app/api/admin/import-geocache/__tests__/route.test.ts`
- Modify: `src/app/api/admin/refresh-grid-mv/__tests__/route.test.ts`
- Modify: `src/app/api/admin/cleanup/__tests__/route.test.ts`
- Modify: `src/app/api/admin/organic-score-stats/__tests__/route.test.ts`
- Modify: `src/app/api/admin/delete-user/__tests__/route.test.ts`

- [ ] **Step 1: Run tests before changes to confirm current state**

```bash
rtk vitest run src/app/api/admin
```

Expected: all tests pass. This is the baseline.

- [ ] **Step 2: Update `clear-geocache` tests**

In `src/app/api/admin/clear-geocache/__tests__/route.test.ts`, find the test "returns 401 when admin auth fails (non-prod)" and update:

```ts
// Before
it("returns 401 when admin auth fails (non-prod)", async () => {
  mockRequireAdminAuth.mockReturnValue(
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  );
  const res = await POST(makeReq());
  expect(res.status).toBe(401);
});

// After
it("returns 404 when admin auth fails (non-prod)", async () => {
  mockRequireAdminAuth.mockReturnValue(
    new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
  );
  const res = await POST(makeReq());
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Update `import-geocache` tests**

In `src/app/api/admin/import-geocache/__tests__/route.test.ts`, same pattern — find the auth-failure test and replace 401 → 404 in both the mock setup and the assertion.

- [ ] **Step 4: Update `refresh-grid-mv` tests**

`refresh-grid-mv` has 3 auth-related assertions (1 POST + 2 GET). In `__tests__/route.test.ts`:

For the POST test (around line 53):
```ts
// Before
it("returns 401 when admin auth fails", async () => {
  mockRequireAdminAuth.mockReturnValue(
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  );
  const res = await POST(makePost());
  expect(res.status).toBe(401);
});

// After
it("returns 404 when admin auth fails", async () => {
  mockRequireAdminAuth.mockReturnValue(
    new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
  );
  const res = await POST(makePost());
  expect(res.status).toBe(404);
});
```

For the GET tests (around lines 84 and 91) — these test `CRON_SECRET` validation, not `requireAdminAuth`. Leave `status: 401` as-is for the cron GET handler since that is a different auth path (cron token, not admin auth). Do NOT change the GET assertions.

- [ ] **Step 5: Update `cleanup` tests**

In `src/app/api/admin/cleanup/__tests__/route.test.ts`:
- The POST auth test (around line 64): change mock and assertion from 401 → 404
- The GET tests for CRON_SECRET (around lines 103 and 110): **leave as 401** — these are the cron GET handler tests, not `requireAdminAuth`

- [ ] **Step 6: Update `organic-score-stats` tests**

In `src/app/api/admin/organic-score-stats/__tests__/route.test.ts`:
- Find the auth failure test (around line 48): change mock and assertion from 401 → 404

- [ ] **Step 7: Update `delete-user` tests**

In `src/app/api/admin/delete-user/__tests__/route.test.ts`:
- Find the auth failure test (around line 65): change mock and assertion from 401 → 404

- [ ] **Step 8: Run all admin tests to confirm green**

```bash
rtk vitest run src/app/api/admin
```

Expected: all tests pass. If any still fail, the mock return value or assertion status hasn't been fully updated.

- [ ] **Step 9: Full test suite to check no regressions**

```bash
rtk vitest run
```

Expected: same pass count as before this task.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/admin/
git commit -m "test(admin): update auth-failure assertions from 401 to 404 to match new requireAdminAuth behavior"
```

---

## Task 3: Clean the CHANGELOG

The goal: keep product-level descriptions ("what changed for users"), remove security implementation mechanics ("how the protection works"). An attacker reading the changelog should learn about features, not about bypass vectors.

**Files:**
- Modify: `CHANGELOG.md`

**Rules for editing:**
- **Keep**: feature names, user-visible behavior, bug descriptions without exploit details
- **Remove**: exact header names used for auth, exact rate limit numbers per minute per endpoint, exact validation rule parameters (e.g. ±5min, ±50%), cache key format (SHA-256, prefix length), exact TTL values, exact lock mechanism names (nx-lock, TOCTOU)
- **Replace**: detailed security entries → one-liner at product level

- [ ] **Step 1: Clean the v0.4.0 Security section**

Current (lines ~119–126):
```markdown
### Security

- **Dynamic CSP nonces** — Middleware generates a nonce per request (`crypto.randomUUID()`), passes it via the `x-nonce` header, and builds a `Content-Security-Policy` with `'nonce-{n}'` — removes `unsafe-inline`. `layout.tsx` reads the nonce and applies it to both inline scripts. The static CSP directive in `next.config.ts` is removed (handled dynamically).
- **HMAC cookie on POST routes** — When `SM_TOKEN_SECRET` is set, the middleware verifies an HMAC session cookie on all POST routes. curl/server-side calls without a cookie are blocked; browsers automatically send the HttpOnly cookie.
- **Rate limit fail-closed** — `rateLimit()` with `failClosed=true` on all POST routes: if Redis is unavailable, returns 503 instead of silently passing through.
- **HMAC-signed PAT cache** — `pat:*` entries in Upstash are signed via HMAC-SHA256 (`CACHE_SIGN_SECRET`). An attacker with Redis access cannot forge a value without the signing key. Falls back to plain string if `CACHE_SIGN_SECRET` is absent.
- **Reduced PAT cache TTL** — 300s → 60s: token revocation window reduced from 5 min to 1 min.
- **Redis nx-lock on news publish** — `SET NX` lock before the cooldown check + creation to prevent TOCTOU (two concurrent requests passing the cooldown simultaneously → duplicate).
```

Replace with:
```markdown
### Security

- **Dynamic CSP nonces** — Per-request nonces on inline scripts, replacing static `unsafe-inline` in CSP.
- **POST route protection** — HMAC session verification on all POST routes.
- **Rate limit resilience** — Rate limits fail safely when the Redis backend is unavailable.
- **PAT cache hardening** — Token cache entries are integrity-protected. Revocation window reduced.
- **News publish anti-race** — Concurrent publish requests are serialized to prevent duplicate posts.
```

- [ ] **Step 2: Clean the v0.4.0 Bug Fixes section**

Current entry for "Middleware":
```markdown
- **Middleware** — `POST_LIMITERS` was using an exact match on POST routes, missing routes with dynamic segments (e.g. `/api/news/item/123`). Replaced with regex.
```

Replace with:
```markdown
- **Middleware** — Rate limiting now correctly covers routes with dynamic segments.
```

Current entry for "News cooldown":
```markdown
- **News cooldown** — Soft-deleted posts were not counted in the 24h window, allowing publish → delete → immediate re-publish. The cooldown now includes deleted entries.
```

Replace with:
```markdown
- **News cooldown** — Cooldown window now correctly includes deleted posts.
```

Current entry for "Web Vitals":
```markdown
- **Web Vitals** — Whitelist of valid metric names (`CLS`, `FID`, `FCP`, `LCP`, `TTFB`, `INP`) + validation that numeric fields are actually numbers. Prevents arbitrary data injection into the `web_vitals` table.
```

Replace with:
```markdown
- **Web Vitals** — Input validation strengthened on the vitals endpoint.
```

Current entry for "Organic score":
```markdown
- **Organic score** — The `/api/organic-score/refresh` endpoint had no server-side guard on the feature flag. Guard added: returns 404 if `NEXT_PUBLIC_ORGANIC_SCORE_ENABLED !== "true"`.
```

Replace with:
```markdown
- **Organic score** — Feature flag enforcement added on the refresh endpoint.
```

- [ ] **Step 3: Clean the v0.2.0 Security section**

This is the most detailed section. Current content runs from around line ~270 to ~288. Replace the entire Security section:

Current:
```markdown
### Security

- **HMAC session token** — `sm-token` cookie (HttpOnly + SameSite=Strict), signed HMAC-SHA256 via Web Crypto API (Edge-compatible). Issued on each page load, verified on all strict-get endpoints. Requires `SM_TOKEN_SECRET`. Blocks scraping via forged Referer even with a valid cookie.
- **Distributed rate limiting** — Replaced in-memory counters (per-instance Vercel) with Upstash Redis sliding windows. Limits survive serverless scaling. Tiers: chunk 100/min, strict-get 30/min, moderate-get 60/min, admin 10/min, stargazer-cache-get 3/min (dedicated).
- **Cloudflare IP** — Middleware reads `CF-Connecting-IP` before `x-forwarded-for`: per-IP limits use the real visitor IP behind Cloudflare (previously: ~15 fixed Cloudflare IPs seen by Upstash).
- **Dedicated stargazer-cache tier** — `GET /api/stargazer-cache/*` gets its own 3 req/min limiter instead of sharing the strict-get 30/min pool. A single cache hit returns up to 50k users.
- **Route promotion** — `/api/repos` and `/api/explore/global-map` moved from moderate-get to strict-get (Referer + HMAC). Both were enumeration entry points without origin validation.
- **Pagination caps** — `explore/top` and `explore/power`: `MAX_SKIP=500`. `explore/top`: minimum 2-character filter to block single-character cross-product enumeration.
- **Referer verification** on all strict-get endpoints (stargazer-cache, stats, explore/top|power|user-repos|global-map, repos, profile).
- **Origin check** — POST endpoints reject non-localhost origins when `NEXT_PUBLIC_APP_URL` is absent (previously: check silently ignored).
- **Stargazer-cache write protection** — POST validates: timestamp freshness (±5min), plausibility (totalCount within ±50% of existing value), maximum 100k users.
- **XSS fix** — `stargazer-map.tsx` popup: replaced `innerHTML` template literal with `createTextNode` + `createElement`. Eliminates the XSS vector on the `topLogin` field.
- **Hardened CSP** — `unsafe-eval` removed from `script-src` in production (dev only). `Strict-Transport-Security` added (max-age=2y). `X-Robots-Tag: noindex, nofollow` on all `/api/*` routes.
- **Input validation** — Unicode character whitelist on `country`/`search` params in `explore/top`.
- **Error sanitization** — `sanitizeError`/`logError` in `api-helpers` strips Postgres URLs, Bearer tokens, and GitHub PATs from server logs before they reach the Vercel dashboard.
- **GET side-effect removed** — `explore/user-repos` no longer performs DB writes on GET.
- **Reduced lat/lng precision** — API responses round coordinates to 2 decimal places (~1.1km). Full precision preserved in DB.
- **Semgrep SAST CI** — Workflow on push/PR to main and weekly (Sunday 02:00 UTC). Covers typescript, owasp-top-ten, secrets, nodejs.
```

Replace with:
```markdown
### Security

- **HMAC session token** — HttpOnly session cookie issued on each page load, verified on sensitive endpoints.
- **Distributed rate limiting** — Per-IP Redis sliding windows replacing per-instance in-memory counters. Survives serverless scaling. Tiers per endpoint sensitivity.
- **Referer + origin verification** — All sensitive endpoints validate request origin.
- **Stargazer-cache write protection** — Freshness and plausibility checks on cache writes.
- **XSS fix** — Map popup switched from `innerHTML` to DOM API construction.
- **CSP hardening** — `unsafe-eval` removed in production. HSTS added.
- **Input validation** — Character filtering on search parameters in the Explore tab.
- **Error sanitization** — Credentials stripped from server logs before they reach Vercel dashboard.
- **Coordinate precision** — API responses return rounded coordinates (~1km). Full precision stays in DB.
- **Semgrep SAST CI** — Automated OWASP/secrets scan on push and weekly.
```

- [ ] **Step 4: Clean the v0.3.3 Internal section**

Current:
```markdown
### Internal

- **`CircuitBreaker` class** — Extracted from `geocoder.ts` into a reusable class. Unit tests added.
- **Cache refactor** — `compressToGzBase64` centralized in `compression.ts`. `buildUserWritePayload` extracted into the chunk route.
- **Pre-open-source hardening** — Secrets audit, hardened `.gitignore`, reduced timing attacks.
```

Replace with:
```markdown
### Internal

- **`CircuitBreaker` class** — Extracted into a reusable class. Unit tests added.
- **Cache refactor** — Compression utilities centralized.
- **Pre-open-source hardening** — Secrets audit, hardened `.gitignore`.
```

- [ ] **Step 5: Clean the v0.3.2 Internal section**

Current:
```markdown
### Internal

- **Tests** — CircuitBreaker suite (pre-extraction). Fixed `chunk route` + `github` stubs that were silently failing.
- **SEO / a11y / perf audit** — Robots, sitemap, structured data, focus management, missing aria labels, bundle size.
- **Security** — Pre-open-source hardening: secrets excluded from the repo, hardened `.gitignore`, reduced timing side-channels.
```

Replace with:
```markdown
### Internal

- **Tests** — CircuitBreaker suite added. Fixed stubs that were silently passing.
- **SEO / a11y / perf audit** — Robots, sitemap, structured data, focus management, aria labels, bundle size.
- **Security** — Pre-open-source hardening.
```

- [ ] **Step 6: Clean the v0.3.4 Internal section**

Current:
```markdown
### Internal

- **Weight rebalancing** — Two calibration passes: watcher 10%→5%, fork 70%→40%, zero-fork 25%→55%. More discriminating results on real repos.
- **Methodology docs** — `docs/organic-score.md`: StarScout vs StarMapper comparison, normalization formula, known limitations.
```

The weight details (%) are product internals, not security-sensitive. Leave as-is.

- [ ] **Step 7: Clean the v0.3.4 Features section (admin endpoint reference)**

Current entry in Features:
```markdown
- **Organic score calibration page** — `/api/admin/calibrate-organic-score` — debug page to compare scores on a real sample, accessible locally.
```

Replace with:
```markdown
- **Organic score calibration** — Debug tool to compare scores on a real sample (local dev only).
```

- [ ] **Step 8: Verify the file looks correct**

```bash
rtk read CHANGELOG.md
```

Scan for: any remaining `x-admin-secret`, `ADMIN_SECRET`, `SHA-256`, `nx-lock`, `TOCTOU`, `±5min`, `±50%`, specific `/min` rate limit numbers.

- [ ] **Step 9: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): redact security implementation details — keep product-level language only"
```

---

## Task 4: Final verification

- [ ] **Step 1: Full test suite**

```bash
rtk vitest run
```

Expected: same pass count as before (no regressions from the 404 change).

- [ ] **Step 2: TypeScript clean**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 3: Verify prod admin routes return 404 without the secret**

```bash
curl -s -o /dev/null -w "%{http_code}" https://starmapper.bruniaux.com/api/admin/refresh-grid-mv
```

Expected: `404`. If you get `401` or `403`, the Vercel deployment hasn't picked up the change yet or the deploy failed.

- [ ] **Step 4: Verify prod admin routes work WITH the secret**

```bash
curl -s -X POST https://starmapper.bruniaux.com/api/admin/organic-score-stats \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -w "\n%{http_code}"
```

Expected: `200` with JSON body. If you get `404`, `ADMIN_SECRET` is not set in Vercel env vars — add it in the dashboard.

---

## Execution order

Tasks are independent except Task 4 (verification) which must come last. Suggested order:

1. Task 1 (code change) → 2 (tests) → commit both → 3 (changelog) → 4 (verify after deploy)
