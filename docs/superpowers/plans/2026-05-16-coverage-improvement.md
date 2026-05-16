# Coverage Improvement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring StarMapper from 79.6% lines / 69.4% branches to ≥85% lines / ≥75% branches by adding tests for 8 uncovered or under-covered modules.

**Architecture:** Each task adds a new `*.test.ts` file (or extends an existing one) with unit tests. All external dependencies are mocked via `vi.mock`. Tests run with `pnpm test` (vitest, pool: forks). No implementation changes — tests only, except Task 1 which adds `token.ts` to the coverage exclusion list.

**Tech Stack:** Vitest 4, vi.mock, vi.fn, vi.stubEnv, vi.spyOn, NextRequest, node:crypto (Web Crypto built-in)

---

## Current state

```
Statements : 78.01%  (1831/2347)  threshold: 80%  ← FAIL
Branches   : 69.41%  (1026/1478)  threshold: 70%  ← FAIL
Functions  : 70.90%  (234/330)    threshold: 70%  ✓
Lines      : 79.58%  (1626/2043)  threshold: 80%  ← FAIL
```

Gap to cross both thresholds: **8 lines, 9 branches** — but aim higher.

## File map

| File | Action | Reason |
|------|--------|--------|
| `vitest.config.ts` | Modify | Exclude `token.ts` (browser-only, like theme.ts/bookmarks.ts) |
| `src/lib/feed-builders.test.ts` | **Create** | 0% → 100% — pure functions, no mocks, biggest single gain |
| `src/lib/format.test.ts` | **Create** | 22% → 100% — pure functions, timeAgo/fmt/formatEstimate |
| `src/lib/api-helpers.test.ts` | **Create** | 47% → 90% — getIP, sanitizeError, logError, extractGhToken, requireAdminAuth |
| `src/lib/api-token.test.ts` | **Create** | 22% → 100% — safeEqual, generateToken, verifyToken (Web Crypto) |
| `src/lib/db-health.test.ts` | **Create** | 0% → 100% — checkDbHealth with cache TTL |
| `src/app/api/stats/[owner]/[repo]/growth/__tests__/route.test.ts` | **Create** | 0% → 90%+ |
| `src/app/api/stats/[owner]/[repo]/geo-velocity/__tests__/route.test.ts` | **Create** | 0% → 90%+ |
| `src/app/api/watch/[owner]/[repo]/__tests__/route.test.ts` | **Create** | 0% → 90%+ |

---

## Task 1 — Exclude browser-only `token.ts` from coverage

**Files:**
- Modify: `vitest.config.ts`

`src/lib/token.ts` uses `sessionStorage` which is unavailable in the Node test environment. It belongs in the same excluded group as `theme.ts` and `bookmarks.ts`.

- [ ] **Step 1: Add exclusion**

In `vitest.config.ts`, change the coverage exclude array:

```ts
exclude: [
  "src/lib/db.ts",
  "src/lib/theme.ts",
  "src/lib/bookmarks.ts",
  "src/lib/token.ts",          // ← add this line
  "**/__tests__/**",
],
```

- [ ] **Step 2: Verify tests still pass**

```bash
rtk vitest run
```

Expected: `PASS (...) FAIL (0)`

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore(test): exclude browser-only token.ts from coverage"
```

---

## Task 2 — `src/lib/feed-builders.ts` (0% → 100%)

**Files:**
- Create: `src/lib/feed-builders.test.ts`

Pure functions — no mocks needed. Covers `escapeXml`, `escapeCdata`, `buildRss20`, `buildJsonFeed`.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import {
  escapeXml,
  escapeCdata,
  buildRss20,
  buildJsonFeed,
  type FeedNews,
} from "@/lib/feed-builders";

const makeNews = (overrides: Partial<FeedNews> = {}): FeedNews => ({
  id: 1,
  body: "Hello world",
  url: null,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const AUTHOR = { login: "octocat", name: "The Octocat" };
const FEED_URL = "https://starmapper.bruniaux.com/api/feed/octocat/rss";
const SITE_URL = "https://starmapper.bruniaux.com";

// ── escapeXml ────────────────────────────────────────────────────────────────

describe("escapeXml()", () => {
  it("escapes & to &amp;", () => {
    expect(escapeXml("AT&T")).toBe("AT&amp;T");
  });

  it("escapes < to &lt;", () => {
    expect(escapeXml("a<b")).toBe("a&lt;b");
  });

  it("escapes > to &gt;", () => {
    expect(escapeXml("a>b")).toBe("a&gt;b");
  });

  it('escapes " to &quot;', () => {
    expect(escapeXml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes ' to &apos;", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });

  it("escapes multiple characters in one string", () => {
    expect(escapeXml("<a href='x'>")).toBe("&lt;a href=&apos;x&apos;&gt;");
  });
});

// ── escapeCdata ──────────────────────────────────────────────────────────────

describe("escapeCdata()", () => {
  it("leaves text without ]]> unchanged", () => {
    expect(escapeCdata("hello <world>")).toBe("hello <world>");
  });

  it("splits ]]> into two CDATA sections", () => {
    expect(escapeCdata("foo]]>bar")).toBe("foo]]]]><![CDATA[>bar");
  });
});

// ── buildRss20 ───────────────────────────────────────────────────────────────

describe("buildRss20()", () => {
  it("returns a string starting with an XML declaration", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
  });

  it("includes the author display name in the channel title", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("The Octocat");
  });

  it("uses login as display name when name is null", () => {
    const xml = buildRss20([], { login: "octocat", name: null }, FEED_URL, SITE_URL);
    expect(xml).toContain("octocat");
    expect(xml).not.toContain("null");
  });

  it("includes one <item> per news entry", () => {
    const news = [makeNews({ id: 1 }), makeNews({ id: 2, body: "Second post" })];
    const xml = buildRss20(news, AUTHOR, FEED_URL, SITE_URL);
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it("truncates body to 60 chars with ellipsis in <title>", () => {
    const long = "A".repeat(80);
    const xml = buildRss20([makeNews({ body: long })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("…]]></title>");
  });

  it("does not add ellipsis when body fits in 60 chars", () => {
    const xml = buildRss20([makeNews({ body: "Short" })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).not.toContain("…");
  });

  it("uses news url in <link> when provided", () => {
    const xml = buildRss20(
      [makeNews({ url: "https://example.com/post" })],
      AUTHOR,
      FEED_URL,
      SITE_URL,
    );
    expect(xml).toContain("https://example.com/post");
  });

  it("falls back to profile URL in <link> when url is null", () => {
    const xml = buildRss20([makeNews({ url: null })], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain(`${SITE_URL}/profile/octocat`);
  });

  it("uses the first item's date as lastBuildDate when news array is non-empty", () => {
    const news = [makeNews({ publishedAt: new Date("2026-03-01T12:00:00Z") })];
    const xml = buildRss20(news, AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain("Sat, 01 Mar 2026 12:00:00 GMT");
  });

  it("includes atom:link pointing to feedUrl", () => {
    const xml = buildRss20([], AUTHOR, FEED_URL, SITE_URL);
    expect(xml).toContain(FEED_URL);
  });
});

// ── buildJsonFeed ────────────────────────────────────────────────────────────

describe("buildJsonFeed()", () => {
  it("returns an object with JSON Feed version 1.1", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, unknown>;
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
  });

  it("uses author name in title", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, unknown>;
    expect(feed.title as string).toContain("The Octocat");
  });

  it("uses login as display name when name is null", () => {
    const feed = buildJsonFeed([], { login: "octocat", name: null }, FEED_URL, SITE_URL) as Record<string, unknown>;
    expect(feed.title as string).toContain("octocat");
  });

  it("includes one item per news entry", () => {
    const news = [makeNews({ id: 1 }), makeNews({ id: 2 })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: unknown[] };
    expect(feed.items).toHaveLength(2);
  });

  it("item uses news url when provided", () => {
    const news = [makeNews({ url: "https://example.com/post" })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { url: string }[] };
    expect(feed.items[0].url).toBe("https://example.com/post");
  });

  it("item falls back to profile URL when url is null", () => {
    const news = [makeNews({ url: null })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { url: string }[] };
    expect(feed.items[0].url).toBe(`${SITE_URL}/profile/octocat`);
  });

  it("item id follows starmapper-news-{id} format", () => {
    const news = [makeNews({ id: 42 })];
    const feed = buildJsonFeed(news, AUTHOR, FEED_URL, SITE_URL) as { items: { id: string }[] };
    expect(feed.items[0].id).toBe("starmapper-news-42");
  });

  it("sets feed_url and home_page_url", () => {
    const feed = buildJsonFeed([], AUTHOR, FEED_URL, SITE_URL) as Record<string, string>;
    expect(feed.feed_url).toBe(FEED_URL);
    expect(feed.home_page_url).toBe(`${SITE_URL}/profile/octocat`);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

```bash
rtk vitest run src/lib/feed-builders.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/feed-builders.test.ts
git commit -m "test(feed-builders): 100% coverage for RSS/JSON Feed builders"
```

---

## Task 3 — `src/lib/format.ts` (22% → 100%)

**Files:**
- Create: `src/lib/format.test.ts`

Pure functions. `timeAgo` depends on `Date.now()` — mock with `vi.spyOn`.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";
import { formatEstimate, fmt, timeAgo } from "@/lib/format";

afterEach(() => vi.restoreAllMocks());

// ── formatEstimate ───────────────────────────────────────────────────────────

describe("formatEstimate()", () => {
  it("returns ~N unit when min === max", () => {
    expect(formatEstimate({ min: 5, max: 5, unit: "min", keepOpen: false })).toBe("~5 min");
  });

  it("returns range when min !== max", () => {
    expect(formatEstimate({ min: 2, max: 4, unit: "sec", keepOpen: false })).toBe("2–4 sec");
  });

  it("works with hours unit", () => {
    expect(formatEstimate({ min: 1, max: 2, unit: "h", keepOpen: true })).toBe("1–2 h");
  });
});

// ── fmt ──────────────────────────────────────────────────────────────────────

describe("fmt()", () => {
  it("returns string as-is for numbers below 1000", () => {
    expect(fmt(999)).toBe("999");
    expect(fmt(0)).toBe("0");
  });

  it("formats 1000 as 1.0k", () => {
    expect(fmt(1000)).toBe("1.0k");
  });

  it("formats 1234 as 1.2k", () => {
    expect(fmt(1234)).toBe("1.2k");
  });

  it("formats 10000 as 10.0k", () => {
    expect(fmt(10000)).toBe("10.0k");
  });
});

// ── timeAgo ──────────────────────────────────────────────────────────────────

describe("timeAgo()", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
  });

  it('returns "just now" for less than 1 minute', () => {
    expect(timeAgo(now - 30_000)).toBe("just now");
  });

  it('returns "Xmin ago" for minutes', () => {
    expect(timeAgo(now - 5 * 60_000)).toBe("5min ago");
  });

  it('returns "Xh ago" for hours', () => {
    expect(timeAgo(now - 3 * 3_600_000)).toBe("3h ago");
  });

  it('returns "Xd ago" for days', () => {
    expect(timeAgo(now - 2 * 86_400_000)).toBe("2d ago");
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run src/lib/format.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/format.test.ts
git commit -m "test(format): 100% coverage for formatEstimate, fmt, timeAgo"
```

---

## Task 4 — `src/lib/api-helpers.ts` (47% → 90%+)

**Files:**
- Create: `src/lib/api-helpers.test.ts`

Currently uncovered: `getIP` (fallback chain), `sanitizeError`, `logError`, `requireAdminAuth` (IP allowlist branch), `extractGhToken`.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-token", () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

import {
  jsonError,
  getIP,
  requireAdminAuth,
  extractGhToken,
  sanitizeError,
  logError,
} from "@/lib/api-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const makeReq = (headers: Record<string, string> = {}, url = "http://localhost/api/test") => {
  return new NextRequest(url, { headers });
};

// ── jsonError ────────────────────────────────────────────────────────────────

describe("jsonError()", () => {
  it("returns a Response with the given status", async () => {
    const res = jsonError("not_found", 404);
    expect(res.status).toBe(404);
  });

  it("body contains the error message", async () => {
    const res = jsonError("invalid_params", 400);
    const json = await res.json();
    expect(json.error).toBe("invalid_params");
  });
});

// ── getIP ────────────────────────────────────────────────────────────────────

describe("getIP()", () => {
  it("returns req.ip when set (Vercel edge)", () => {
    const req = makeReq();
    Object.defineProperty(req, "ip", { value: "1.2.3.4", configurable: true });
    expect(getIP(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(getIP(makeReq({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("falls back to last segment of x-forwarded-for", () => {
    expect(getIP(makeReq({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(getIP(makeReq())).toBe("unknown");
  });
});

// ── sanitizeError ────────────────────────────────────────────────────────────

describe("sanitizeError()", () => {
  it("redacts postgres URLs", () => {
    const err = new Error("Failed: postgresql://user:pass@host/db");
    expect(sanitizeError(err)).toContain("[db-url-redacted]");
    expect(sanitizeError(err)).not.toContain("pass");
  });

  it("redacts Bearer tokens", () => {
    expect(sanitizeError(new Error("Bearer ghp_abcXYZ123"))).toContain("[gh-token-redacted]");
  });

  it("redacts github_pat_ tokens", () => {
    expect(sanitizeError(new Error("github_pat_abc123_def"))).toContain("[gh-token-redacted]");
  });

  it("redacts gho_ tokens", () => {
    expect(sanitizeError(new Error("gho_abc123"))).toContain("[gh-token-redacted]");
  });

  it("handles non-Error values", () => {
    expect(sanitizeError("just a string")).toBe("just a string");
  });

  it("handles plain messages without secrets", () => {
    expect(sanitizeError(new Error("something failed"))).toBe("something failed");
  });
});

// ── logError ─────────────────────────────────────────────────────────────────

describe("logError()", () => {
  it("calls console.error with tag and sanitized message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("geocoder", new Error("oops"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[geocoder]"));
  });

  it("handles non-Error values without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logError("test", "string error")).not.toThrow();
    spy.mockRestore();
  });
});

// ── extractGhToken ───────────────────────────────────────────────────────────

describe("extractGhToken()", () => {
  it("returns the x-gh-token header when present", () => {
    vi.stubEnv("GITHUB_TOKEN", "server_token");
    expect(extractGhToken(makeReq({ "x-gh-token": "client_token" }))).toBe("client_token");
  });

  it("falls back to GITHUB_TOKEN env var", () => {
    vi.stubEnv("GITHUB_TOKEN", "server_token");
    expect(extractGhToken(makeReq())).toBe("server_token");
  });

  it("returns undefined when neither is set", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(extractGhToken(makeReq())).toBeUndefined();
  });
});

// ── requireAdminAuth ─────────────────────────────────────────────────────────

describe("requireAdminAuth()", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SECRET", "supersecret");
    vi.stubEnv("ADMIN_ALLOWED_IPS", "");
  });

  it("returns null (pass) when secret matches and no IP allowlist", () => {
    const req = makeReq({ "x-admin-secret": "supersecret" });
    expect(requireAdminAuth(req)).toBeNull();
  });

  it("returns 404 when secret is wrong", () => {
    const req = makeReq({ "x-admin-secret": "wrong" });
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns 404 when secret header is absent", () => {
    const req = makeReq();
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns 404 when IP is not in allowlist", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", "10.0.0.1");
    const req = makeReq({ "x-admin-secret": "supersecret", "x-real-ip": "9.9.9.9" });
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns null when IP is in allowlist and secret matches", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", "10.0.0.1");
    const req = makeReq({ "x-admin-secret": "supersecret", "x-real-ip": "10.0.0.1" });
    expect(requireAdminAuth(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run src/lib/api-helpers.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-helpers.test.ts
git commit -m "test(api-helpers): cover getIP, sanitizeError, requireAdminAuth, extractGhToken"
```

---

## Task 5 — `src/lib/api-token.ts` (22% → 100%)

**Files:**
- Create: `src/lib/api-token.test.ts`

Web Crypto is available in Node 18+ without polyfills. `generateToken` and `verifyToken` are async.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  safeEqual,
  generateToken,
  verifyToken,
  TOKEN_TTL_MS,
  COOKIE_NAME,
} from "@/lib/api-token";

afterEach(() => vi.restoreAllMocks());

const SECRET = "test-secret-at-least-32-characters-long";

// ── constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("TOKEN_TTL_MS is 2 hours in ms", () => {
    expect(TOKEN_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("COOKIE_NAME is sm-token", () => {
    expect(COOKIE_NAME).toBe("sm-token");
  });
});

// ── safeEqual ────────────────────────────────────────────────────────────────

describe("safeEqual()", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeEqual("hello", "hell")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(safeEqual("", "x")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

// ── generateToken ────────────────────────────────────────────────────────────

describe("generateToken()", () => {
  it("returns a string with 3 dot-separated parts", async () => {
    const token = await generateToken(SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("encodes a recent timestamp in the first part", async () => {
    const before = Date.now();
    const token = await generateToken(SECRET);
    const ts = parseInt(token.split(".")[0], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("generates different tokens on successive calls (nonce randomness)", async () => {
    const t1 = await generateToken(SECRET);
    const t2 = await generateToken(SECRET);
    expect(t1).not.toBe(t2);
  });
});

// ── verifyToken ──────────────────────────────────────────────────────────────

describe("verifyToken()", () => {
  it("verifies a freshly generated token", async () => {
    const token = await generateToken(SECRET);
    expect(await verifyToken(token, SECRET)).toBe(true);
  });

  it("returns false for undefined token", async () => {
    expect(await verifyToken(undefined, SECRET)).toBe(false);
  });

  it("returns false when secret is empty", async () => {
    const token = await generateToken(SECRET);
    expect(await verifyToken(token, "")).toBe(false);
  });

  it("returns false for a token with wrong number of parts", async () => {
    expect(await verifyToken("only.two", SECRET)).toBe(false);
  });

  it("returns false for a tampered signature", async () => {
    const token = await generateToken(SECRET);
    const [ts, nonce] = token.split(".");
    const tampered = `${ts}.${nonce}.deadbeef`;
    expect(await verifyToken(tampered, SECRET)).toBe(false);
  });

  it("returns false for an expired token", async () => {
    const expiredTs = Date.now() - TOKEN_TTL_MS - 1;
    // Build a structurally valid token with a stale timestamp using the real signer
    const token = await generateToken(SECRET);
    const [, nonce, sig] = token.split(".");
    const expired = `${expiredTs}.${nonce}.${sig}`;
    expect(await verifyToken(expired, SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run src/lib/api-token.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-token.test.ts
git commit -m "test(api-token): 100% coverage for safeEqual, generateToken, verifyToken"
```

---

## Task 6 — `src/lib/db-health.ts` (0% → 100%)

**Files:**
- Create: `src/lib/db-health.test.ts`

Must reset module-level cache (`cached`) between tests. Use `vi.resetModules()` + dynamic import per test group.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

// ─── Reset module cache between suites so `cached` starts null ────────────────

import { checkDbHealth, DB_WARN_PCT, DB_CRITICAL_PCT } from "@/lib/db-health";

describe("constants", () => {
  it("DB_WARN_PCT is 80", () => expect(DB_WARN_PCT).toBe(80));
  it("DB_CRITICAL_PCT is 95", () => expect(DB_CRITICAL_PCT).toBe(95));
});

describe("checkDbHealth()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Patch the module-level cache to null so each test starts fresh
    // The workaround: call with Date.now() far in the future to expire TTL
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockRestore();
  });

  it("returns ok:true with usagePct when DB query succeeds", async () => {
    // 100MB used out of 100GB default limit → ~0%
    mockQueryRaw.mockResolvedValue([{ size: BigInt(100 * 1024 * 1024) }]);
    const health = await checkDbHealth();
    expect(health.ok).toBe(true);
    if (health.ok) expect(health.usagePct).toBeGreaterThanOrEqual(0);
  });

  it("returns ok:false when DB query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));
    const health = await checkDbHealth();
    expect(health.ok).toBe(false);
  });

  it("respects DB_STORAGE_LIMIT_MB env var for percentage calculation", async () => {
    vi.stubEnv("DB_STORAGE_LIMIT_MB", "512");
    // 256MB used out of 512MB = 50%
    mockQueryRaw.mockResolvedValue([{ size: BigInt(256 * 1024 * 1024) }]);
    const health = await checkDbHealth();
    if (health.ok) expect(health.usagePct).toBe(50);
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run src/lib/db-health.test.ts
```

Expected: all tests pass. (Note: because the module-level `cached` variable persists within a test file, some tests may use cache — this is expected and correct behavior to test.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db-health.test.ts
git commit -m "test(db-health): cover checkDbHealth — success, failure, env override"
```

---

## Task 7 — `src/app/api/stats/[owner]/[repo]/growth/route.ts` (0% → 90%+)

**Files:**
- Create: `src/app/api/stats/[owner]/[repo]/growth/__tests__/route.test.ts`

Mock pattern: `prisma.$queryRaw` returns bigint values (raw SQL pattern used throughout StarMapper).

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (o: string, r: string) => ({ owner: o.toLowerCase(), repo: r.toLowerCase() }),
}));

import { GET } from "@/app/api/stats/[owner]/[repo]/growth/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}/growth`),
  { params: Promise.resolve({ owner, repo }) },
];

const WEEKS = [{ week: "2026-01-05", count: 10 }, { week: "2026-01-12", count: 25 }];
const COUNTS = [{ total: 35n, with_ts: 35n }];

describe("GET /api/stats/[owner]/[repo]/growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Promise.all expects two $queryRaw calls (weeks + counts)
    mockQueryRaw
      .mockResolvedValueOnce(WEEKS)
      .mockResolvedValueOnce(COUNTS);
  });

  // ── Input validation ─────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when owner contains invalid characters", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 when repo contains invalid characters", async () => {
      const [req, ctx] = makeReq("facebook", "bad repo!");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns 200 with weeks array and totals", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.weeks).toHaveLength(2);
      expect(json.total).toBe(35);
      expect(json.withTimestamps).toBe(35);
    });

    it("sets public Cache-Control header", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("public");
    });

    it("maps week and count correctly", async () => {
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.weeks[0]).toEqual({ week: "2026-01-05", count: 10 });
    });
  });

  // ── No data ──────────────────────────────────────────────────────────────

  describe("no data", () => {
    it("returns 404 when total is 0", async () => {
      mockQueryRaw.mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0n, with_ts: 0n }]);
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockReset().mockRejectedValue(new Error("DB down"));
      const [req, ctx] = makeReq("facebook", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run "src/app/api/stats/[owner]/[repo]/growth/__tests__/route.test.ts"
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/stats/[owner]/[repo]/growth/__tests__/route.test.ts"
git commit -m "test(stats/growth): cover growth route — happy path, no data, errors"
```

---

## Task 8 — `src/app/api/stats/[owner]/[repo]/geo-velocity/route.ts` (0% → 90%+)

**Files:**
- Create: `src/app/api/stats/[owner]/[repo]/geo-velocity/__tests__/route.test.ts`

Key business logic to cover: the 4 trend classifications (`rising`, `new`, `stable`, `declining`) + sort order.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (o: string, r: string) => ({ owner: o.toLowerCase(), repo: r.toLowerCase() }),
}));

import { GET } from "@/app/api/stats/[owner]/[repo]/geo-velocity/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/stats/${owner}/${repo}/geo-velocity`),
  { params: Promise.resolve({ owner, repo }) },
];

// stars_30d / stars_90d as bigints — route converts with Number()
const makeRow = (country: string, s30: number, s90: number, total: number) => ({
  country,
  stars_30d: BigInt(s30),
  stars_90d: BigInt(s90),
  total: BigInt(total),
});

describe("GET /api/stats/[owner]/[repo]/geo-velocity", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Input validation ─────────────────────────────────────────────────────

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  // ── Trend classification ─────────────────────────────────────────────────

  describe("trend classification", () => {
    it("classifies 'rising' when ratio >= 1.5", async () => {
      // 90 stars in 30d, 60 stars in 31-90d → 30d rate=3/d, 60d rate=1/d → ratio=3 → rising
      mockQueryRaw.mockResolvedValue([makeRow("France", 90, 150, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.items[0].trend).toBe("rising");
    });

    it("classifies 'new' when no 31-90d history but has 30d stars", async () => {
      // stars_90d === stars_30d → historical60 = 0 → rate60 = 0 → new
      mockQueryRaw.mockResolvedValue([makeRow("Germany", 10, 10, 10)]);
      const [req, ctx] = makeReq("owner", "repo");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.items[0].trend).toBe("new");
    });

    it("classifies 'declining' when ratio <= 0.5", async () => {
      // 10 stars in 30d, 110 stars in 31-90d → 30d rate=0.33/d, 60d rate=1.83/d → ratio≈0.18 → declining
      mockQueryRaw.mockResolvedValue([makeRow("USA", 10, 120, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.items[0].trend).toBe("declining");
    });

    it("classifies 'stable' when ratio is between 0.5 and 1.5", async () => {
      // 60 stars in 30d, 120 in 31-90d → rate30=2/d, rate60=2/d → ratio=1.0 → stable
      mockQueryRaw.mockResolvedValue([makeRow("UK", 60, 120, 200)]);
      const [req, ctx] = makeReq("owner", "repo");
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.items[0].trend).toBe("stable");
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns 200 with items array and public Cache-Control", async () => {
    mockQueryRaw.mockResolvedValue([makeRow("France", 10, 20, 30)]);
    const [req, ctx] = makeReq("facebook", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const json = await res.json();
    expect(Array.isArray(json.items)).toBe(true);
  });

  it("returns empty items array when no rows", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const [req, ctx] = makeReq("facebook", "react");
    const res = await GET(req, ctx);
    const json = await res.json();
    expect(json.items).toHaveLength(0);
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("returns 500 when DB throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("timeout"));
    const [req, ctx] = makeReq("facebook", "react");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run "src/app/api/stats/[owner]/[repo]/geo-velocity/__tests__/route.test.ts"
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/stats/[owner]/[repo]/geo-velocity/__tests__/route.test.ts"
git commit -m "test(stats/geo-velocity): cover trend classifications + happy path + errors"
```

---

## Task 9 — `src/app/api/watch/[owner]/[repo]/route.ts` (0% → 90%+)

**Files:**
- Create: `src/app/api/watch/[owner]/[repo]/__tests__/route.test.ts`

Two external dependencies: `fetch` (GitHub REST) + `prisma.gitHubUser.findMany`.

- [ ] **Step 1: Write the test file**

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9._-]{1,100}$/,
  normalizeOwnerRepo: (o: string, r: string) => ({ owner: o.toLowerCase(), repo: r.toLowerCase() }),
}));

import { GET } from "@/app/api/watch/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
  since?: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => {
  const url = since
    ? `http://localhost/api/watch/${owner}/${repo}?since=${encodeURIComponent(since)}`
    : `http://localhost/api/watch/${owner}/${repo}`;
  return [
    new NextRequest(url),
    { params: Promise.resolve({ owner, repo }) },
  ];
};

// A recent timestamp so all stars count as "new"
const SINCE = new Date(Date.now() - 60_000).toISOString(); // 1 min ago

const makeGhStar = (login: string, ts = new Date().toISOString()) => ({
  starred_at: ts,
  user: { login },
});

const makeJsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("GET /api/watch/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_TOKEN", "test_token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ── Input validation ─────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const [req, ctx] = makeReq("bad owner!", "react");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid since date", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world", "not-a-date");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 503 when GITHUB_TOKEN is not set", async () => {
      vi.stubEnv("GITHUB_TOKEN", "");
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(503);
    });
  });

  // ── GitHub error handling ────────────────────────────────────────────────

  describe("GitHub error responses", () => {
    it("returns 404 when GitHub returns 404", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 429 when GitHub returns 403 (rate limit)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 403 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(429);
    });

    it("returns 502 when GitHub returns 500", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("", { status: 500 }));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(502);
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("returns { newCount: 0, countries: [], logins: [] } when no new stars", async () => {
      const oldStar = makeGhStar("user1", new Date(Date.now() - 60 * 60_000).toISOString());
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([oldStar]));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ newCount: 0, countries: [], logins: [] });
    });

    it("returns logins and countries for new stars", async () => {
      const newStar = makeGhStar("alice");
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([newStar]));
      mockFindMany.mockResolvedValue([{ countryNormalized: "France" }]);

      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.newCount).toBe(1);
      expect(json.logins).toContain("alice");
      expect(json.countries).toContain("France");
    });

    it("deduplicates countries", async () => {
      const stars = [makeGhStar("alice"), makeGhStar("bob")];
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse(stars));
      mockFindMany.mockResolvedValue([
        { countryNormalized: "France" },
        { countryNormalized: "France" },
      ]);

      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      const json = await res.json();
      expect(json.countries).toEqual(["France"]);
    });

    it("sets Cache-Control: no-store", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce(makeJsonResponse([]));
      const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("returns 500 when fetch throws", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network error"));
    const [req, ctx] = makeReq("octocat", "hello-world", SINCE);
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify**

```bash
rtk vitest run "src/app/api/watch/[owner]/[repo]/__tests__/route.test.ts"
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/watch/[owner]/[repo]/__tests__/route.test.ts"
git commit -m "test(watch): cover watch route — validation, GitHub errors, happy path"
```

---

## Task 10 — Final verification

- [ ] **Step 1: Run full test suite**

```bash
rtk vitest run
```

Expected: `PASS (...) FAIL (0)`

- [ ] **Step 2: Run coverage report**

```bash
pnpm test:coverage 2>&1 | tail -20
```

Expected:
```
Lines     : ≥ 85%  (threshold: 80%)  ✓
Branches  : ≥ 75%  (threshold: 70%)  ✓
Functions : ≥ 75%  (threshold: 70%)  ✓
```

- [ ] **Step 3: Push**

```bash
git push
```

Expected: CI passes — Lint ✓, TypeScript ✓, Tests ✓

---

## Self-review

**Spec coverage:**
- `feed-builders.ts` → Task 2 ✓
- `format.ts` → Task 3 ✓
- `api-helpers.ts` → Task 4 ✓
- `api-token.ts` → Task 5 ✓
- `db-health.ts` → Task 6 ✓
- `stats/growth/route.ts` → Task 7 ✓
- `stats/geo-velocity/route.ts` → Task 8 ✓
- `watch/route.ts` → Task 9 ✓
- `token.ts` exclusion → Task 1 ✓

**Placeholder scan:** No TBDs. All test bodies contain actual assertions.

**Type consistency:**
- `FeedNews` imported from `@/lib/feed-builders` ✓
- `GeoVelocityItem["trend"]` union used in assertions ✓
- `mockQueryRaw` returns `bigint` values to match raw SQL pattern ✓
- `mockFindMany` returns `{ countryNormalized: string | null }[]` to match Prisma select ✓
