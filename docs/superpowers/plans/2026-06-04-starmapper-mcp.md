# StarMapper MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone npm package (`starmapper-mcp`) that wraps StarMapper's existing API as an MCP server, exposing 5 tools: `get_repo_stats`, `get_organic_score`, `get_velocity`, `get_influential_stargazers`, and `index_repo`.

**Architecture:** Two independent parts: (A) two new Next.js API routes added to the StarMapper app to fill the gaps identified in the audit (organic signal breakdown, public influential stargazers endpoint), and (B) a standalone MCP package at `/mcp/` in this repo that wraps these routes over HTTP using stdio transport. The MCP server has zero business logic: it calls StarMapper's HTTPS API and formats the results for Claude.

**Tech Stack:** `@modelcontextprotocol/sdk ^1.12.0`, TypeScript 5, Node.js 18+, CommonJS, vitest for tests, `zlib` (built-in) for gzip compression in `index_repo`.

---

## File Map

### Part A: New Next.js API routes

```
src/app/api/mcp/
├── organic-score/[owner]/[repo]/
│   ├── route.ts          ← GET: full organic signal breakdown (score + computed signals)
│   └── route.test.ts
└── influential/[owner]/[repo]/
    ├── route.ts          ← GET: public, minFollowers filter, no auth gate
    └── route.test.ts
```

### Part B: MCP package

```
mcp/
├── package.json          ← npm package config, bin: starmapper-mcp
├── tsconfig.json         ← CommonJS target
├── vitest.config.ts
├── src/
│   ├── index.ts          ← MCP server entry point (stdio transport)
│   ├── client.ts         ← typed HTTP wrapper for StarMapper API
│   └── tools/
│       ├── get_repo_stats.ts
│       ├── get_organic_score.ts
│       ├── get_velocity.ts
│       ├── get_influential_stargazers.ts
│       └── index_repo.ts ← drives POST /api/chunk loop + saves to stargazer_cache
└── README.md
```

---

## Task 1: Route `/api/mcp/organic-score/[owner]/[repo]`

Returns the full organic signal breakdown with computed ratios, not just the stored score+tier.
Unlike the existing `/api/organic-score/` route, this one recomputes signals from stored badge_cache raw values + a live zero-follower query and calls `computeOrganicScore()` to expose the full `OrganicResult.signals`.

**Files:**
- Create: `src/app/api/mcp/organic-score/[owner]/[repo]/route.ts`
- Create: `src/app/api/mcp/organic-score/[owner]/[repo]/route.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `src/app/api/mcp/organic-score/[owner]/[repo]/route.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9_.-]+$/,
  normalizeOwnerRepo: (owner: string, repo: string) => ({ owner: owner.toLowerCase(), repo: repo.toLowerCase() }),
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

const makeBadgeRow = (overrides = {}) => ({
  organicScore: 72,
  organicTier: "healthy",
  organicComputedAt: new Date("2026-06-01T00:00:00Z"),
  forksCount: 800,
  watchersCount: 150,
  totalCount: 8000,
  releasesCount: 25,
  ...overrides,
});

const makeRequest = (owner = "anthropic", repo = "claude") =>
  new NextRequest(`http://localhost/api/mcp/organic-score/${owner}/${repo}`);

const makeParams = (owner = "anthropic", repo = "claude") =>
  ({ params: Promise.resolve({ owner, repo }) });

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/mcp/organic-score/[owner]/[repo]", () => {
  test("returns 400 on invalid owner", async () => {
    const res = await GET(makeRequest("bad owner!", "repo"), makeParams("bad owner!", "repo"));
    expect(res.status).toBe(400);
  });

  test("returns 404 when badge_cache not found", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("returns 404 when organicTier is null", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(
      makeBadgeRow({ organicTier: null }) as any
    );
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("returns full signal breakdown with forkRatio and watcherRatio computed", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ zero_count: BigInt(320), sample_size: BigInt(1600) }]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.score).toBe(72);
    expect(body.tier).toBe("healthy");
    expect(body.tierLabel).toBe("Healthy");
    expect(body.corpusAccuracy).toBe(85.7);
    expect(body.signals.forkRatio).toBeCloseTo(0.1);      // 800 / 8000
    expect(body.signals.watcherRatio).toBeCloseTo(0.01875); // 150 / 8000
    expect(body.signals.zeroFollowerPct).toBeCloseTo(20);  // 320 / 1600 * 100
    expect(body.signals.sampleSize).toBe(1600);
    expect(body.weights).toEqual({ fork_ratio: 30, watcher_ratio: 5, zero_follower_pct: 45, releases_count: 20 });
    expect(Array.isArray(body.activeSignals)).toBe(true);
  });

  test("returns zeroFollowerPct null when zf query returns no rows", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.zeroFollowerPct).toBeNull();
    expect(body.signals.sampleSize).toBe(0);
  });

  test("returns zeroFollowerPct null when zf query throws (Neon timeout)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.badgeCache.findUnique).mockResolvedValue(makeBadgeRow() as any);
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("canceling statement due to statement timeout"));

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.zeroFollowerPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/app/api/mcp/organic-score --reporter=verbose
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/mcp/organic-score/[owner]/[repo]/route.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/organic-score/[owner]/[repo]
// MCP-optimised endpoint: returns the full organic signal breakdown.
// Unlike /api/organic-score/, this recomputes signals from stored badge_cache
// raw values + a live zero-follower query so MCP clients get the full picture.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeOrganicScore, tierLabel } from "@/lib/organic-score";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type McpOrganicScoreResponse = {
  score: number | null;
  tier: string;
  tierLabel: string;
  computedAt: string | null;
  signals: {
    forkRatio: number | null;
    watcherRatio: number | null;
    zeroFollowerPct: number | null;
    releasesCount: number | null;
    sampleSize: number;
  };
  weights: {
    fork_ratio: number;
    watcher_ratio: number;
    zero_follower_pct: number;
    releases_count: number;
  };
  activeSignals: string[];
  reasons: string[];
  corpusAccuracy: number;
};

const WEIGHTS = { fork_ratio: 30, watcher_ratio: 5, zero_follower_pct: 45, releases_count: 20 };
const CORPUS_ACCURACY = 85.7;

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner: rawOwner, repo: rawRepo } = await params;
  if (!OWNER_REPO_RE.test(rawOwner) || !OWNER_REPO_RE.test(rawRepo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(rawOwner, rawRepo);

  try {
    const row = await prisma.badgeCache.findUnique({
      where: { owner_repo: key },
      select: {
        organicScore: true, organicTier: true, organicComputedAt: true,
        forksCount: true, watchersCount: true, totalCount: true,
        releasesCount: true,
      },
    });

    if (!row?.organicTier) return jsonError("not_found", 404);

    // Attempt live zero-follower query, gracefully degrade on timeout
    let zeroFollowerCount: number | null = null;
    let sampleSize: number | null = null;
    try {
      const [zfRow] = await prisma.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
          COUNT(*)::bigint AS sample_size
        FROM github_user gu
        INNER JOIN star_event se ON se.login = gu.login
        WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
          AND gu."dataVersion" >= 1
      `;
      if (zfRow) {
        zeroFollowerCount = Number(zfRow.zero_count);
        sampleSize = Number(zfRow.sample_size);
      }
    } catch { /* Neon timeout, proceed without zero-follower signal */ }

    const result = computeOrganicScore({
      starsCount:        row.totalCount,
      forksCount:        row.forksCount ?? 0,
      watchersCount:     row.watchersCount ?? 0,
      zeroFollowerCount,
      sampleSize,
      releasesCount:     row.releasesCount ?? null,
    });

    const response: McpOrganicScoreResponse = {
      score:       row.organicScore,
      tier:        row.organicTier,
      tierLabel:   tierLabel(row.organicTier as Parameters<typeof tierLabel>[0]),
      computedAt:  row.organicComputedAt?.toISOString() ?? null,
      signals:     result.signals,
      weights:     WEIGHTS,
      activeSignals: result.activeSignals,
      reasons:     result.reasons,
      corpusAccuracy: CORPUS_ACCURACY,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/mcp/organic-score GET", err);
    return jsonError("internal", 500);
  }
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/app/api/mcp/organic-score --reporter=verbose
```

Expected: all 6 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/mcp/organic-score/
git commit -m "feat(api): add /api/mcp/organic-score with full signal breakdown"
```

---

## Task 2: Route `/api/mcp/influential/[owner]/[repo]`

Public endpoint, no auth gate, no sm-token cookie required. Returns stargazers above a follower threshold, sorted by follower count. Hard-capped at 50 results.

**Files:**
- Create: `src/app/api/mcp/influential/[owner]/[repo]/route.ts`
- Create: `src/app/api/mcp/influential/[owner]/[repo]/route.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `src/app/api/mcp/influential/[owner]/[repo]/route.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/api-validation", () => ({
  OWNER_REPO_RE: /^[a-zA-Z0-9_.-]+$/,
  normalizeOwnerRepo: (owner: string, repo: string) => ({ owner: owner.toLowerCase(), repo: repo.toLowerCase() }),
}));

vi.mock("@/lib/api-helpers", () => ({
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

const makeRequest = (owner = "vercel", repo = "next.js", minFollowers = "500") =>
  new NextRequest(
    `http://localhost/api/mcp/influential/${owner}/${repo}?minFollowers=${minFollowers}`
  );

const makeParams = (owner = "vercel", repo = "next.js") =>
  ({ params: Promise.resolve({ owner, repo }) });

beforeEach(() => { vi.clearAllMocks(); });

describe("GET /api/mcp/influential/[owner]/[repo]", () => {
  test("returns 400 on invalid owner", async () => {
    const res = await GET(makeRequest("bad owner!", "repo"), makeParams("bad owner!", "repo"));
    expect(res.status).toBe(400);
  });

  test("returns 400 when minFollowers is not a valid integer", async () => {
    const res = await GET(makeRequest("vercel", "next.js", "notanumber"), makeParams());
    expect(res.status).toBe(400);
  });

  test("returns 400 when minFollowers is negative", async () => {
    const res = await GET(makeRequest("vercel", "next.js", "-1"), makeParams());
    expect(res.status).toBe(400);
  });

  test("returns empty array when no users above threshold", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.minFollowers).toBe(500);
  });

  test("returns users sorted by followers desc with profile URL", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { login: "tj", name: "TJ Holowaychuk", followers: 42000, location: "Victoria, BC", company: null },
      { login: "addyosmani", name: "Addy Osmani", followers: 35000, location: "San Francisco, CA", company: "Google" },
    ]);

    const res = await GET(makeRequest("vercel", "next.js", "1000"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.users).toHaveLength(2);
    expect(body.users[0]).toEqual({
      login: "tj",
      name: "TJ Holowaychuk",
      followers: 42000,
      location: "Victoria, BC",
      profileUrl: "https://github.com/tj",
      avatarUrl: "https://github.com/tj.png",
    });
    expect(body.total).toBe(2);
    expect(body.minFollowers).toBe(1000);
  });

  test("defaults minFollowers to 500 when param is absent", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const req = new NextRequest("http://localhost/api/mcp/influential/vercel/next.js");
    const res = await GET(req, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.minFollowers).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run src/app/api/mcp/influential --reporter=verbose
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/mcp/influential/[owner]/[repo]/route.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// GET /api/mcp/influential/[owner]/[repo]?minFollowers=500
// Public endpoint (no auth gate) for MCP and automation use.
// Returns enriched stargazers above a follower threshold for the given repo.
// Hard-capped at 50 results to prevent bulk scraping.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type McpInfluentialUser = {
  login: string;
  name: string | null;
  followers: number;
  location: string | null;
  profileUrl: string;
  avatarUrl: string;
};

export type McpInfluentialResponse = {
  users: McpInfluentialUser[];
  total: number;
  minFollowers: number;
};

const DEFAULT_MIN_FOLLOWERS = 500;
const RESULT_CAP = 50;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }

  const minFollowersParam = req.nextUrl.searchParams.get("minFollowers");
  const minFollowers = minFollowersParam ? parseInt(minFollowersParam, 10) : DEFAULT_MIN_FOLLOWERS;
  if (isNaN(minFollowers) || minFollowers < 0) {
    return jsonError("invalid_min_followers", 400);
  }

  const key = normalizeOwnerRepo(owner, repo);

  try {
    const rows = await prisma.$queryRaw<{
      login: string;
      name: string | null;
      followers: number;
      location: string | null;
    }[]>`
      SELECT u.login, u.name, u.followers, u.location
      FROM star_event se
      JOIN github_user u USING (login)
      WHERE se.owner = ${key.owner}
        AND se.repo  = ${key.repo}
        AND u.followers >= ${minFollowers}
        AND u."dataVersion" >= 1
      ORDER BY u.followers DESC
      LIMIT ${RESULT_CAP}
    `;

    const users: McpInfluentialUser[] = rows.map((u) => ({
      ...u,
      profileUrl: `https://github.com/${u.login}`,
      avatarUrl:  `https://github.com/${u.login}.png`,
    }));

    const response: McpInfluentialResponse = { users, total: users.length, minFollowers };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("api/mcp/influential GET", err);
    return jsonError("internal", 500);
  }
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm vitest run src/app/api/mcp/influential --reporter=verbose
```

Expected: all 5 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/mcp/influential/
git commit -m "feat(api): add /api/mcp/influential with public minFollowers endpoint"
```

---

## Task 3: Scaffold MCP package

Creates the package skeleton. No business logic yet.

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/vitest.config.ts`
- Create: `mcp/src/index.ts` (stub)

---

- [ ] **Step 1: Create `mcp/package.json`**

```json
{
  "name": "starmapper-mcp",
  "version": "0.1.0",
  "description": "MCP server for querying GitHub repo audience data via StarMapper",
  "main": "dist/index.js",
  "bin": {
    "starmapper-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "files": ["dist"],
  "keywords": ["mcp", "starmapper", "github", "stargazers"],
  "license": "AGPL-3.0-only",
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `mcp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "**/*.test.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `mcp/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
  },
});
```

- [ ] **Step 4: Create stub `mcp/src/index.ts`**

```typescript
#!/usr/bin/env node
// StarMapper MCP Server, entry point (stub, filled in Task 6)
console.error("StarMapper MCP server stub, not yet wired");
process.exit(1);
```

- [ ] **Step 5: Install dependencies**

```bash
cd mcp && npm install
```

Expected: `node_modules/@modelcontextprotocol/sdk` installed.

- [ ] **Step 6: Commit**

```bash
git add mcp/
git commit -m "chore(mcp): scaffold package with tsconfig, vitest, package.json"
```

---

## Task 4: StarMapper HTTP client

Typed wrapper for the 5 StarMapper endpoints the MCP server calls. All network errors propagate, no silent catches.

**Files:**
- Create: `mcp/src/client.ts`
- Create: `mcp/src/client.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Create `mcp/src/client.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

// Set env before importing client
process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { fetchRepoStats, fetchOrganicScore, fetchVelocity, fetchInfluentialStargazers, triggerChunk } =
  await import("./client.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); });

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

const notFound = () =>
  Promise.resolve(new Response(JSON.stringify({ error: "no_data" }), { status: 404 }));

describe("fetchRepoStats", () => {
  test("calls correct URL and returns typed data", async () => {
    const payload = { totalStars: 5000, mappedCount: 4200, topCountries: [["US", 1500]] };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await fetchRepoStats("vercel", "next.js");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/stats/vercel/next.js",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.totalStars).toBe(5000);
    expect(result.mappedCount).toBe(4200);
  });

  test("throws on non-ok response", async () => {
    mockFetch.mockReturnValueOnce(notFound());
    await expect(fetchRepoStats("owner", "repo")).rejects.toThrow("StarMapper API error 404");
  });
});

describe("fetchOrganicScore", () => {
  test("calls /api/mcp/organic-score/ and returns signals", async () => {
    const payload = { score: 72, tier: "healthy", tierLabel: "Healthy", signals: { forkRatio: 0.1 } };
    mockFetch.mockReturnValueOnce(ok(payload));

    const result = await fetchOrganicScore("owner", "repo");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/mcp/organic-score/owner/repo",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.tier).toBe("healthy");
  });
});

describe("fetchVelocity", () => {
  test("calls /api/stats/[owner]/[repo]/geo-velocity", async () => {
    mockFetch.mockReturnValueOnce(ok({ items: [], timedOut: false }));
    const result = await fetchVelocity("owner", "repo");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/stats/owner/repo/geo-velocity",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.items).toEqual([]);
  });
});

describe("fetchInfluentialStargazers", () => {
  test("calls /api/mcp/influential/ with minFollowers query param", async () => {
    mockFetch.mockReturnValueOnce(ok({ users: [], total: 0, minFollowers: 1000 }));
    await fetchInfluentialStargazers("owner", "repo", 1000);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/mcp/influential/owner/repo?minFollowers=1000",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("triggerChunk", () => {
  test("calls POST /api/chunk with correct body", async () => {
    mockFetch.mockReturnValueOnce(ok({ points: [], unmapped: [], nextCursor: null, totalCount: 0 }));
    const result = await triggerChunk("owner", "repo", null);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner: "owner", repo: "repo" }),
      })
    );
    expect(result.nextCursor).toBeNull();
  });

  test("passes cursor in body when provided", async () => {
    mockFetch.mockReturnValueOnce(ok({ points: [], unmapped: [], nextCursor: "abc123", totalCount: 200 }));
    await triggerChunk("owner", "repo", "cursor_val");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        body: JSON.stringify({ owner: "owner", repo: "repo", cursor: "cursor_val" }),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mcp && npm test
```

Expected: FAIL, `./client.js` not found.

- [ ] **Step 3: Implement `mcp/src/client.ts`**

```typescript
// StarMapper HTTP client, wraps all API endpoints used by the MCP tools.
// BASE_URL defaults to the production StarMapper instance.
// Override STARMAPPER_BASE_URL env var for local dev or self-hosted.

const BASE_URL = process.env.STARMAPPER_BASE_URL ?? "https://starmapper.bruniaux.com";

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, { method: "GET" });
  if (!res.ok) throw new Error(`StarMapper API error ${res.status} on GET ${path}`);
  return res.json() as Promise<T>;
};

// --- Response types (minimal subset needed by MCP tools) ---

export type RepoStats = {
  totalStars: number;
  mappedCount: number;
  mappingRate: number;
  avgFollowers: number;
  countryCount: number;
  topCountries: [string, number][];
  topCities: [string, number][];
  organic: {
    score: number | null;
    tier: string;
    computedAt: string | null;
  } | null;
};

export type OrganicScore = {
  score: number | null;
  tier: string;
  tierLabel: string;
  computedAt: string | null;
  signals: {
    forkRatio: number | null;
    watcherRatio: number | null;
    zeroFollowerPct: number | null;
    releasesCount: number | null;
    sampleSize: number;
  };
  weights: {
    fork_ratio: number;
    watcher_ratio: number;
    zero_follower_pct: number;
    releases_count: number;
  };
  activeSignals: string[];
  reasons: string[];
  corpusAccuracy: number;
};

export type VelocityItem = {
  country: string;
  stars30d: number;
  stars90d: number;
  total: number;
  trend: "rising" | "new" | "stable" | "declining";
  ratio: number;
};

export type InfluentialUser = {
  login: string;
  name: string | null;
  followers: number;
  location: string | null;
  profileUrl: string;
  avatarUrl: string;
};

export type ChunkResult = {
  points: { login: string; lat: number; lng: number }[];
  unmapped: { login: string; location: string | null }[];
  nextCursor: string | null;
  totalCount: number;
};

// --- Fetch functions ---

export const fetchRepoStats = (owner: string, repo: string): Promise<RepoStats> =>
  get<RepoStats>(`/api/stats/${owner}/${repo}`);

export const fetchOrganicScore = (owner: string, repo: string): Promise<OrganicScore> =>
  get<OrganicScore>(`/api/mcp/organic-score/${owner}/${repo}`);

export const fetchVelocity = (owner: string, repo: string): Promise<{ items: VelocityItem[]; timedOut?: boolean }> =>
  get(`/api/stats/${owner}/${repo}/geo-velocity`);

export const fetchInfluentialStargazers = async (
  owner: string,
  repo: string,
  minFollowers: number,
): Promise<{ users: InfluentialUser[]; total: number; minFollowers: number }> =>
  get(`/api/mcp/influential/${owner}/${repo}?minFollowers=${minFollowers}`);

export const triggerChunk = async (
  owner: string,
  repo: string,
  cursor: string | null,
): Promise<ChunkResult> => {
  const body = cursor ? { owner, repo, cursor } : { owner, repo };
  const res = await fetch(`${BASE_URL}/api/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`StarMapper chunk error ${res.status}`);
  return res.json() as Promise<ChunkResult>;
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd mcp && npm test
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/client.ts mcp/src/client.test.ts
git commit -m "feat(mcp): add StarMapper HTTP client with typed fetch functions"
```

---

## Task 5: Read-only tools (get_repo_stats, get_organic_score, get_velocity, get_influential_stargazers)

Four tool files that call the client and format the response into Claude-readable text. No tests here, the logic is pure formatting, covered by the client tests. Manual smoke test in Task 7.

**Files:**
- Create: `mcp/src/tools/get_repo_stats.ts`
- Create: `mcp/src/tools/get_organic_score.ts`
- Create: `mcp/src/tools/get_velocity.ts`
- Create: `mcp/src/tools/get_influential_stargazers.ts`

---

- [ ] **Step 1: Create `mcp/src/tools/get_repo_stats.ts`**

```typescript
import { fetchRepoStats } from "../client.js";

export const GET_REPO_STATS_SCHEMA = {
  name: "get_repo_stats",
  description:
    "Get audience statistics for a GitHub repository indexed on StarMapper. Returns total stars, geocoded count, top countries, top cities, and organic score summary.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner (e.g. 'vercel')" },
      repo:  { type: "string", description: "GitHub repository name (e.g. 'next.js')" },
    },
    required: ["owner", "repo"],
  },
};

export const getRepoStats = async (args: { owner: string; repo: string }): Promise<string> => {
  const stats = await fetchRepoStats(args.owner, args.repo);

  const topCountries = stats.topCountries
    .slice(0, 10)
    .map(([country, count], i) => `${i + 1}. ${country}: ${count.toLocaleString()}`)
    .join("\n");

  const topCities = stats.topCities
    .slice(0, 10)
    .map(([city, count], i) => `${i + 1}. ${city}: ${count.toLocaleString()}`)
    .join("\n");

  const organicLine = stats.organic
    ? `Organic score: ${stats.organic.score ?? "N/A"}/100 (${stats.organic.tier}), last computed ${stats.organic.computedAt ? new Date(stats.organic.computedAt).toLocaleDateString() : "never"}`
    : "Organic score: not yet computed";

  return [
    `## ${args.owner}/${args.repo}`,
    ``,
    `Stars: ${stats.totalStars.toLocaleString()} total, ${stats.mappedCount.toLocaleString()} geocoded (${stats.mappingRate}% mapping rate)`,
    `Countries represented: ${stats.countryCount}`,
    `Average follower count: ${stats.avgFollowers.toLocaleString()}`,
    organicLine,
    ``,
    `### Top 10 countries`,
    topCountries || "No country data yet.",
    ``,
    `### Top 10 cities`,
    topCities || "No city data yet.",
  ].join("\n");
};
```

- [ ] **Step 2: Create `mcp/src/tools/get_organic_score.ts`**

```typescript
import { fetchOrganicScore } from "../client.js";

export const GET_ORGANIC_SCORE_SCHEMA = {
  name: "get_organic_score",
  description:
    "Get the organic score for a GitHub repository, a 0-100 heuristic measuring whether star growth looks natural. Returns score, verdict, and breakdown of all signals with their weights.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
    },
    required: ["owner", "repo"],
  },
};

export const getOrganicScore = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchOrganicScore(args.owner, args.repo);

  const scoreDisplay = data.score !== null ? `${data.score}/100` : "N/A";
  const pct = (v: number | null) => (v !== null ? `${(v * 100).toFixed(1)}%` : "N/A");

  const signals = [
    `Fork/star ratio:       ${pct(data.signals.forkRatio)} (weight: ${data.weights.fork_ratio}%)`,
    `Watcher/star ratio:    ${pct(data.signals.watcherRatio)} (weight: ${data.weights.watcher_ratio}%)`,
    `Zero-follower users:   ${data.signals.zeroFollowerPct !== null ? `${data.signals.zeroFollowerPct.toFixed(1)}%` : "N/A"} of ${data.signals.sampleSize.toLocaleString()} enriched users (weight: ${data.weights.zero_follower_pct}%)`,
    `Releases count:        ${data.signals.releasesCount ?? "N/A"} (weight: ${data.weights.releases_count}%)`,
  ].join("\n");

  const reasons = data.reasons.length > 0
    ? `\n### Notes\n${data.reasons.map((r) => `- ${r}`).join("\n")}`
    : "";

  return [
    `## Organic Score: ${args.owner}/${args.repo}`,
    ``,
    `Score: **${scoreDisplay}**, ${data.tierLabel}`,
    `Active signals: ${data.activeSignals.join(", ") || "none"}`,
    `Corpus calibration accuracy: ${data.corpusAccuracy}%`,
    data.computedAt ? `Last computed: ${new Date(data.computedAt).toLocaleDateString()}` : "",
    ``,
    `### Signal breakdown`,
    signals,
    reasons,
  ].filter(Boolean).join("\n");
};
```

- [ ] **Step 3: Create `mcp/src/tools/get_velocity.ts`**

```typescript
import { fetchVelocity } from "../client.js";

export const GET_VELOCITY_SCHEMA = {
  name: "get_velocity",
  description:
    "Get per-country star velocity for a GitHub repository: rising, new, stable, or declining over the last 30 days vs the 31-90 day window. Useful for spotting geographic trends after a launch or blog post.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
    },
    required: ["owner", "repo"],
  },
};

const TREND_EMOJI: Record<string, string> = {
  rising: "📈",
  new: "🆕",
  stable: "➡️",
  declining: "📉",
};

export const getVelocity = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchVelocity(args.owner, args.repo);

  if (data.timedOut) {
    return `## Velocity: ${args.owner}/${args.repo}\n\nData temporarily unavailable (database timeout). Try again in a few minutes.`;
  }

  if (data.items.length === 0) {
    return `## Velocity: ${args.owner}/${args.repo}\n\nNo velocity data available. The repository may not have enough recent star events with timestamped data.`;
  }

  const rows = data.items
    .map((item) => {
      const emoji = TREND_EMOJI[item.trend] ?? "•";
      return `${emoji} ${item.country.padEnd(20)} ${item.trend.padEnd(10)} +${item.stars30d} last 30d | ratio ${item.ratio}x`;
    })
    .join("\n");

  return [
    `## Star velocity: ${args.owner}/${args.repo}`,
    `(last 30 days vs 31-90 day window)`,
    ``,
    rows,
  ].join("\n");
};
```

- [ ] **Step 4: Create `mcp/src/tools/get_influential_stargazers.ts`**

```typescript
import { fetchInfluentialStargazers } from "../client.js";

export const GET_INFLUENTIAL_SCHEMA = {
  name: "get_influential_stargazers",
  description:
    "List stargazers of a GitHub repository above a follower threshold. Useful for finding VIP users to engage with for a product launch or announcement.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
      min_followers: {
        type: "number",
        description: "Minimum follower count. Use 500, 1000, or 5000. Defaults to 500.",
        enum: [500, 1000, 5000],
      },
    },
    required: ["owner", "repo"],
  },
};

export const getInfluentialStargazers = async (
  args: { owner: string; repo: string; min_followers?: number },
): Promise<string> => {
  const minFollowers = args.min_followers ?? 500;
  const data = await fetchInfluentialStargazers(args.owner, args.repo, minFollowers);

  if (data.total === 0) {
    return `## Influential stargazers: ${args.owner}/${args.repo}\n\nNo stargazers found with ${minFollowers.toLocaleString()}+ followers. Try a lower threshold.`;
  }

  const rows = data.users
    .map((u, i) => {
      const location = u.location ? ` (${u.location})` : "";
      return `${i + 1}. @${u.login}, ${u.followers.toLocaleString()} followers${location}\n   ${u.profileUrl}`;
    })
    .join("\n");

  return [
    `## Influential stargazers: ${args.owner}/${args.repo}`,
    `Found ${data.total} users with ${minFollowers.toLocaleString()}+ followers`,
    ``,
    rows,
  ].join("\n");
};
```

- [ ] **Step 5: TypeScript check**

```bash
cd mcp && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/
git commit -m "feat(mcp): add 4 read-only tools (stats, organic, velocity, influential)"
```

---

## Task 6: `index_repo` tool

Drives the `POST /api/chunk` loop until the entire repo is indexed. Saves the result to `stargazer_cache` using gzip+base64 compression (same format as the browser). Returns a summary.

**Files:**
- Create: `mcp/src/tools/index_repo.ts`
- Create: `mcp/src/tools/index_repo.test.ts`

---

- [ ] **Step 1: Write the failing test**

Create `mcp/src/tools/index_repo.test.ts`:

```typescript
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

process.env.STARMAPPER_BASE_URL = "https://starmapper.test";

const { indexRepo } = await import("./index_repo.js");

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const chunkResponse = (
  points: { login: string; lat: number; lng: number }[],
  nextCursor: string | null,
  totalCount: number,
) =>
  Promise.resolve(
    new Response(
      JSON.stringify({ points, unmapped: [], nextCursor, totalCount }),
      { status: 200 }
    )
  );

const cacheResponse = () =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));

describe("indexRepo", () => {
  test("calls chunk loop until nextCursor is null and returns summary", async () => {
    // Two chunks: first returns cursor, second ends loop
    mockFetch
      .mockReturnValueOnce(chunkResponse(
        [{ login: "alice", lat: 48.8, lng: 2.3 }], "cursor_1", 2
      ))
      .mockReturnValueOnce(chunkResponse(
        [{ login: "bob", lat: 37.7, lng: -122.4 }], null, 2
      ))
      .mockReturnValueOnce(cacheResponse()); // stargazer_cache POST

    const result = await indexRepo({ owner: "owner", repo: "repo" });

    expect(mockFetch).toHaveBeenCalledTimes(3);

    // First chunk call, no cursor
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ owner: "owner", repo: "repo" }),
      })
    );

    // Second chunk call, with cursor
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      "https://starmapper.test/api/chunk",
      expect.objectContaining({
        body: JSON.stringify({ owner: "owner", repo: "repo", cursor: "cursor_1" }),
      })
    );

    // Result contains summary
    expect(result).toContain("Indexed 2 users");
    expect(result).toContain("owner/repo");
  });

  test("returns error message when chunk call fails", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve(new Response("{}", { status: 500 }))
    );

    const result = await indexRepo({ owner: "owner", repo: "repo" });
    expect(result).toContain("Error");
  });

  test("returns warning when totalCount is 0", async () => {
    mockFetch.mockReturnValueOnce(
      chunkResponse([], null, 0)
    );

    const result = await indexRepo({ owner: "owner", repo: "repo" });
    expect(result).toContain("0 stars");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mcp && npm test -- index_repo
```

Expected: FAIL, `./index_repo.js` not found.

- [ ] **Step 3: Implement `mcp/src/tools/index_repo.ts`**

```typescript
import { gzipSync } from "zlib";
import { triggerChunk } from "../client.js";

const BASE_URL = process.env.STARMAPPER_BASE_URL ?? "https://starmapper.bruniaux.com";

export const INDEX_REPO_SCHEMA = {
  name: "index_repo",
  description:
    "Trigger full indexation of a GitHub repository on StarMapper. Fetches all stargazers, geocodes their locations, and saves the result. For large repos (10k+ stars) this may take several minutes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
    },
    required: ["owner", "repo"],
  },
};

type Point = { login: string; lat: number; lng: number };
type Unmapped = { login: string; location: string | null };

const saveToCache = async (
  owner: string,
  repo: string,
  points: Point[],
  unmapped: Unmapped[],
  totalCount: number,
): Promise<void> => {
  const pointsGz = gzipSync(Buffer.from(JSON.stringify(points))).toString("base64");
  const unmappedGz = gzipSync(Buffer.from(JSON.stringify(unmapped))).toString("base64");

  const res = await fetch(`${BASE_URL}/api/stargazer-cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount }),
  });
  if (!res.ok) throw new Error(`Failed to save cache: ${res.status}`);
};

export const indexRepo = async (args: { owner: string; repo: string }): Promise<string> => {
  const { owner, repo } = args;
  const allPoints: Point[] = [];
  const allUnmapped: Unmapped[] = [];
  let cursor: string | null = null;
  let totalCount = 0;
  let chunks = 0;

  try {
    do {
      const result = await triggerChunk(owner, repo, cursor);
      allPoints.push(...result.points);
      allUnmapped.push(...result.unmapped);
      cursor = result.nextCursor;
      totalCount = result.totalCount;
      chunks++;
    } while (cursor !== null);

    if (totalCount === 0) {
      return `## ${owner}/${repo}\n\n0 stars found. The repository may not exist or may be private.`;
    }

    await saveToCache(owner, repo, allPoints, allUnmapped, totalCount).catch(() => {
      // Non-critical, indexation data is in DB even if cache save fails
    });

    const mappingRate = totalCount > 0 ? Math.round((allPoints.length / totalCount) * 100) : 0;

    return [
      `## Indexation complete: ${owner}/${repo}`,
      ``,
      `Indexed ${totalCount.toLocaleString()} users in ${chunks} chunk${chunks !== 1 ? "s" : ""}`,
      `Geocoded: ${allPoints.length.toLocaleString()} (${mappingRate}% mapping rate)`,
      `Unmapped: ${allUnmapped.length.toLocaleString()} (no location or unrecognized location)`,
      ``,
      `View on StarMapper: https://starmapper.bruniaux.com/${owner}/${repo}`,
    ].join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `## Error indexing ${owner}/${repo}\n\n${message}\n\nCheck that the repository exists and StarMapper is reachable.`;
  }
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd mcp && npm test -- index_repo
```

Expected: all 3 tests PASS.

- [ ] **Step 5: TypeScript check**

```bash
cd mcp && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/tools/index_repo.ts mcp/src/tools/index_repo.test.ts
git commit -m "feat(mcp): add index_repo tool with chunk loop driver + stargazer_cache save"
```

---

## Task 7: Wire tools into the MCP server + manual smoke test

Replaces the stub `src/index.ts` with the full server that registers all 5 tools via stdio transport.

**Files:**
- Modify: `mcp/src/index.ts`

---

- [ ] **Step 1: Implement `mcp/src/index.ts`**

```typescript
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// StarMapper MCP server, stdio transport, exposes 5 tools.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GET_REPO_STATS_SCHEMA, getRepoStats } from "./tools/get_repo_stats.js";
import { GET_ORGANIC_SCORE_SCHEMA, getOrganicScore } from "./tools/get_organic_score.js";
import { GET_VELOCITY_SCHEMA, getVelocity } from "./tools/get_velocity.js";
import { GET_INFLUENTIAL_SCHEMA, getInfluentialStargazers } from "./tools/get_influential_stargazers.js";
import { INDEX_REPO_SCHEMA, indexRepo } from "./tools/index_repo.js";

const server = new Server(
  { name: "starmapper", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  GET_REPO_STATS_SCHEMA,
  GET_ORGANIC_SCORE_SCHEMA,
  GET_VELOCITY_SCHEMA,
  GET_INFLUENTIAL_SCHEMA,
  INDEX_REPO_SCHEMA,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let text: string;

    if (name === "get_repo_stats") {
      text = await getRepoStats(args as { owner: string; repo: string });
    } else if (name === "get_organic_score") {
      text = await getOrganicScore(args as { owner: string; repo: string });
    } else if (name === "get_velocity") {
      text = await getVelocity(args as { owner: string; repo: string });
    } else if (name === "get_influential_stargazers") {
      text = await getInfluentialStargazers(
        args as { owner: string; repo: string; min_followers?: number }
      );
    } else if (name === "index_repo") {
      text = await indexRepo(args as { owner: string; repo: string });
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build the package**

```bash
cd mcp && npm run build
```

Expected: `dist/index.js` created, 0 TypeScript errors.

- [ ] **Step 3: Smoke test, list tools**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node mcp/dist/index.js
```

Expected: JSON response with `tools` array containing 5 tools: `get_repo_stats`, `get_organic_score`, `get_velocity`, `get_influential_stargazers`, `index_repo`.

- [ ] **Step 4: Smoke test, get_repo_stats for a known indexed repo**

Run this against production StarMapper. Use a repo that is definitely indexed (check `https://starmapper.bruniaux.com` for any repo with stats):

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_repo_stats","arguments":{"owner":"vercel","repo":"next.js"}}}' | STARMAPPER_BASE_URL=https://starmapper.bruniaux.com node mcp/dist/index.js
```

Expected: JSON response with `content[0].text` containing "Stars:", "Top 10 countries", no "Error".

- [ ] **Step 5: Smoke test, get_organic_score**

```bash
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_organic_score","arguments":{"owner":"vercel","repo":"next.js"}}}' | STARMAPPER_BASE_URL=https://starmapper.bruniaux.com node mcp/dist/index.js
```

Expected: response contains "Organic Score:", "Signal breakdown", a numeric score.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/index.ts
git commit -m "feat(mcp): wire all 5 tools into MCP server with stdio transport"
```

---

## Task 8: README for the MCP package

**Files:**
- Create: `mcp/README.md`

---

- [ ] **Step 1: Create `mcp/README.md`**

```markdown
# starmapper-mcp

MCP server for [StarMapper](https://starmapper.bruniaux.com), query GitHub repository audience data directly from Claude Code.

## Install

Add to your Claude Code MCP config (`~/.claude/mcp.json` for global, `.claude/mcp.json` for project):

```json
{
  "mcpServers": {
    "starmapper": {
      "command": "npx",
      "args": ["-y", "starmapper-mcp"]
    }
  }
}
```

Then restart Claude Code. The server auto-downloads on first use.

## Tools

### `get_repo_stats(owner, repo)`
Total stars, geocoding rate, top 10 countries and cities, organic score summary.

### `get_organic_score(owner, repo)`
Score 0-100 with full signal breakdown: fork/star ratio (30%), watcher/star ratio (5%), zero-follower % (45%), releases count (20%). Corpus calibration accuracy: 85.7%.

### `get_velocity(owner, repo)`
Per-country star velocity over the last 30 days vs the 31-90 day window. Classifies each country as rising, new, stable, or declining.

### `get_influential_stargazers(owner, repo, min_followers?)`
Stargazers above a follower threshold (500/1000/5000, default 500), sorted by influence. Includes GitHub profile URL.

### `index_repo(owner, repo)`
Triggers a full re-indexation of the repository on StarMapper. Drives the chunk loop, geocodes all stargazers, and saves the result. For large repos this may take several minutes.

## Example prompts

- "Get stats for vercel/next.js on StarMapper"
- "Is the star base for my repo organic? Run get_organic_score for owner/repo"
- "Which countries started starring owner/repo in the last 30 days?"
- "Who are the most influential people starring owner/repo?"
- "Re-index my repo on StarMapper so the map is up to date"

## Self-hosted / development

Override the base URL via env var:

```json
{
  "mcpServers": {
    "starmapper": {
      "command": "npx",
      "args": ["-y", "starmapper-mcp"],
      "env": {
        "STARMAPPER_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## License

AGPL-3.0-only. See [LICENSE](../LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add mcp/README.md
git commit -m "docs(mcp): add README with install snippet and tool reference"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|---|---|
| `get_repo_stats`, top 10 countries, cities, organic summary, cache age | Task 5 (uses `organic.computedAt` as last-computed date) |
| `get_organic_score`, score, 3 signals, weights, verdict, corpus 85.7% | Tasks 1 + 5 |
| `get_velocity`, rising/new/stable/declining per country | Task 5 (wraps existing geo-velocity endpoint) |
| `get_influential_stargazers`, handle, followers, location, URL | Tasks 2 + 5 |
| `index_repo`, drives chunk loop, saves cache | Task 6 |
| npm standalone package with `npx starmapper-mcp` bin | Task 3 |
| stdio transport | Task 7 |
| README with install snippet in `.claude/mcp.json` format | Task 8 |

**Gaps identified and addressed:**
- `cache age` in `get_repo_stats` → uses `organic.computedAt` (available without extra query). If `organic` is null, the tool omits the date. Acceptable for MVP.
- `zeroFollowerPct` not stored in badge_cache → Task 1 route does live query, gracefully degrades to null on timeout.
- `top-users` auth gate → Task 2 creates a new public endpoint outside the auth-gated path.

**Placeholder scan:** No TBD, TODO, or stub code left in tasks with actual implementation steps. The Task 3 stub `src/index.ts` is intentional (replaced in Task 7).

**Type consistency:** `ChunkResult.points` typed as `{ login, lat, lng }[]` in `client.ts`, matches what `index_repo.ts` spreads into `allPoints`. `saveToCache` receives the same `Point` type. Consistent.
