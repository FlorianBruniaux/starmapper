# GitHub Stargazer Restriction, Recovery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two already-built data pipelines (Phase 1b engaged-audience write path, and the not-yet-built Phase 1 reconstruction) actually visible to visitors, close the Phase 2 coverage-metric gap, and get an unresolved legal blocker in front of a human instead of sitting silently in a doc.

**Architecture:** Two new read-only API routes (`/api/engaged/[owner]/[repo]`, `/api/reconstruct/[owner]/[repo]`) mirror the existing `/api/stargazer-cache/[owner]/[repo]` route exactly (same gzip+base64 cache pattern, same ETag convention, same `StargazerPoint` shape). `src/hooks/use-repo-cache-loader.ts` gets a fallback chain: `stargazer_cache` → `/api/reconstruct` → `/api/engaged` → give up (existing empty-map notice). A new `dataSource` field threads through so the UI can label degraded data honestly instead of presenting it as a full scan.

**Tech Stack:** Next.js route handlers, Prisma (`$queryRaw` for the reconstruction join), existing `gzipSync`/`gunzipSync` compression helpers, Vitest.

## Global Constraints

- No `function` keyword, use `const x = () => {}` only, per `.claude/rules/code-conventions.md`.
- `import type` for type-only imports.
- No `any`. No new arbitrary Tailwind values.
- Every new `src/lib/` or `src/app/api/` file ships with a test in the same PR, per `.claude/rules/tdd-mandatory.md`.
- Coordinates always rounded to 2 decimals (`Math.round(x * 100) / 100`) before leaving the server, matching `src/app/api/chunk/route.ts:163`.
- Neon DDL: never `CREATE INDEX CONCURRENTLY`; prefix any raw DDL script with `SET statement_timeout = 0;`.
- `rtk tsc` must show 0 new errors before any task is considered done.
- Commit after every task, conventional format: `type(scope): imperative lowercase message`.

---

## Task 1: `/api/engaged/[owner]/[repo]` read route (Track A)

Makes the already-shipped `EngagedCache` table (`570a367`, currently write-only) readable. Mirrors `src/app/api/stargazer-cache/[owner]/[repo]/route.ts` almost line for line.

**Files:**
- Create: `src/app/api/engaged/[owner]/[repo]/route.ts`
- Test: `src/app/api/engaged/[owner]/[repo]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `prisma.engagedCache.findUnique` (schema at `prisma/schema.prisma:88`, fields `pointsGz`, `unmappedGz`, `knownCount`, `starCount`, `channels`, `scannedAt`), `decompressGzBase64<T>(value: string): T[]` from `@/lib/compression`, `validateOwnerRepo` from `@/lib/api-validation`, `jsonError`/`logError` from `@/lib/api-helpers`.
- Produces: `GET` handler returning `{ points: StargazerPoint[], unmapped: unknown[], knownCount: number, starCount: number, channels: string[], scannedAt: string }` at 200, `404` on no cache, `400` on invalid owner/repo, `500` on DB error. Consumed by Track C.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/engaged/[owner]/[repo]/__tests__/route.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFind = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    engagedCache: { findUnique: (...args: unknown[]) => mockFind(...args) },
  },
}));

const POINTS = [{ login: "a", lat: 1, lng: 2 }];
const UNMAPPED = [{ login: "b" }];

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: (v: unknown) => {
    if (v === "gz_points") return POINTS;
    if (v === "gz_unmapped") return UNMAPPED;
    return [];
  },
}));

import { GET } from "@/app/api/engaged/[owner]/[repo]/route";

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/engaged/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const SCANNED_AT = new Date("2026-07-26T00:00:00Z");
const ROW = {
  scannedAt: SCANNED_AT,
  pointsGz: "gz_points",
  unmappedGz: "gz_unmapped",
  knownCount: 2,
  starCount: 100,
  channels: "fork,issue,pr,mention,watch",
};

describe("GET /api/engaged/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFind.mockResolvedValue(null);
  });

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "repo");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no engaged_cache row exists", async () => {
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 200 with points, unmapped, knownCount, starCount, channels", async () => {
    mockFind.mockResolvedValue(ROW);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.knownCount).toBe(2);
    expect(json.starCount).toBe(100);
    expect(json.channels).toEqual(["fork", "issue", "pr", "mention", "watch"]);
    expect(Array.isArray(json.points)).toBe(true);
    expect(Array.isArray(json.unmapped)).toBe(true);
  });

  it("adds avatarUrl derived from login when missing from stored point", async () => {
    mockFind.mockResolvedValue(ROW);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].avatarUrl).toBe("https://github.com/a.png");
  });

  it("returns 500 when DB throws", async () => {
    mockFind.mockRejectedValue(new Error("DB error"));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk vitest run src/app/api/engaged/[owner]/[repo]/__tests__/route.test.ts`
Expected: FAIL, `Cannot find module '@/app/api/engaged/[owner]/[repo]/route'`

- [ ] **Step 3: Write the route**

```typescript
// src/app/api/engaged/[owner]/[repo]/route.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { decompressGzBase64 } from "@/lib/compression";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const cached = await prisma.engagedCache.findUnique({
      where: { owner_repo: key },
      select: {
        pointsGz: true,
        unmappedGz: true,
        knownCount: true,
        starCount: true,
        channels: true,
        scannedAt: true,
      },
    });
    if (!cached) return jsonError("not_found", 404);

    const points = decompressGzBase64<Record<string, unknown>>(cached.pointsGz);
    const unmapped = decompressGzBase64(cached.unmappedGz);

    const pointsWithAvatar = points.map((p) => ({
      ...p,
      avatarUrl: p.avatarUrl ?? `https://github.com/${p.login}.png`,
      ...(typeof p.lat === "number" && typeof p.lng === "number"
        ? { lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 }
        : {}),
    }));

    return NextResponse.json(
      {
        points: pointsWithAvatar,
        unmapped,
        knownCount: cached.knownCount,
        starCount: cached.starCount,
        channels: cached.channels.split(","),
        scannedAt: cached.scannedAt.toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    logError("engaged GET", err);
    return jsonError("internal", 500);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk vitest run src/app/api/engaged/[owner]/[repo]/__tests__/route.test.ts`
Expected: PASS, 5/5

- [ ] **Step 5: `rtk tsc` clean, then commit**

```bash
rtk tsc
git add "src/app/api/engaged/[owner]/[repo]/route.ts" "src/app/api/engaged/[owner]/[repo]/__tests__/route.test.ts"
git commit -m "feat(api): add engaged-audience read route"
```

---

## Task 2: `/api/reconstruct/[owner]/[repo]` read route (Track B)

Ships ROADMAP.md Phase 1, currently unbuilt despite the doc calling it "the near-term win... does not wait on Phase 3" (`docs/ROADMAP.md:80`). Joins `star_event` and `github_user` on `login`, filtered by `owner`/`repo`. Zero new GitHub API calls, works purely off the 33M rows already in `star_event`.

**Files:**
- Create: `src/app/api/reconstruct/[owner]/[repo]/route.ts`
- Test: `src/app/api/reconstruct/[owner]/[repo]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `prisma.$queryRaw` against `star_event` (`prisma/schema.prisma:153`, unique on `[login, owner, repo]`, indexed on `[owner, repo, login]`) joined to `github_user` (`prisma/schema.prisma:104`, PK `login`), `validateOwnerRepo`, `jsonError`, `logError`.
- Produces: `GET` handler returning `{ points: StargazerPoint[], unmapped: {login: string}[], totalCount: number }` at 200 (`totalCount` is the row count found in `star_event` for this repo, not GitHub's live star count), `400`/`404`/`500`. Consumed by Track C. `404` when zero rows exist for the repo (never scanned, nothing to reconstruct from).

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/reconstruct/[owner]/[repo]/__tests__/route.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

import { GET } from "@/app/api/reconstruct/[owner]/[repo]/route";

const makeReq = (
  owner: string,
  repo: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => [
  new NextRequest(`http://localhost/api/reconstruct/${owner}/${repo}`),
  { params: Promise.resolve({ owner, repo }) },
];

const ROWS = [
  { login: "a", name: null, company: null, location: "Paris", followers: 10, lat: 48.8566, lng: 2.3522, starredAt: new Date("2024-01-01") },
  { login: "b", name: null, company: null, location: null, followers: 3, lat: null, lng: null, starredAt: new Date("2024-01-02") },
];

describe("GET /api/reconstruct/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([]);
  });

  it("returns 400 for invalid owner", async () => {
    const [req, ctx] = makeReq("bad owner!", "repo");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when star_event has no rows for this repo", async () => {
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("splits rows into mapped points and unmapped by lat/lng presence", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points).toHaveLength(1);
    expect(json.points[0].login).toBe("a");
    expect(json.unmapped).toHaveLength(1);
    expect(json.unmapped[0].login).toBe("b");
    expect(json.totalCount).toBe(2);
  });

  it("rounds lat/lng to 2 decimals", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].lat).toBe(48.86);
    expect(json.points[0].lng).toBe(2.35);
  });

  it("derives avatarUrl from login", async () => {
    mockQueryRaw.mockResolvedValue(ROWS);
    const [req, ctx] = makeReq("octocat", "hello");
    const json = await (await GET(req, ctx)).json();
    expect(json.points[0].avatarUrl).toBe("https://github.com/a.png");
  });

  it("returns 500 when the query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB error"));
    const [req, ctx] = makeReq("octocat", "hello");
    const res = await GET(req, ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk vitest run src/app/api/reconstruct/[owner]/[repo]/__tests__/route.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Write the route**

```typescript
// src/app/api/reconstruct/[owner]/[repo]/route.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateOwnerRepo } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

type Row = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  lat: number | null;
  lng: number | null;
  starredAt: Date;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = validateOwnerRepo(owner, repo);
  if (!key) return jsonError("invalid_params", 400);

  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT u.login, u.name, u.company, u.location, u.followers, u.lat, u.lng, se."starredAt"
      FROM star_event se
      JOIN github_user u ON u.login = se.login
      WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
      ORDER BY se."starredAt" DESC
    `;
    if (rows.length === 0) return jsonError("not_found", 404);

    const points = rows
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        login: r.login,
        name: r.name,
        bio: null,
        company: r.company,
        location: r.location,
        followers: r.followers,
        avatarUrl: `https://github.com/${r.login}.png`,
        lat: Math.round((r.lat as number) * 100) / 100,
        lng: Math.round((r.lng as number) * 100) / 100,
        starredAt: r.starredAt.toISOString(),
        linkedinUrl: null,
      }));
    const unmapped = rows
      .filter((r) => r.lat === null || r.lng === null)
      .map((r) => ({ login: r.login }));

    return NextResponse.json(
      { points, unmapped, totalCount: rows.length },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    logError("reconstruct GET", err);
    return jsonError("internal", 500);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk vitest run src/app/api/reconstruct/[owner]/[repo]/__tests__/route.test.ts`
Expected: PASS, 6/6

- [ ] **Step 5: `rtk tsc` clean, then commit**

```bash
rtk tsc
git add "src/app/api/reconstruct/[owner]/[repo]/route.ts" "src/app/api/reconstruct/[owner]/[repo]/__tests__/route.test.ts"
git commit -m "feat(api): add star_event reconstruction read route"
```

---

## Task 3: wire the fallback chain into the repo page (Track C)

`src/hooks/use-repo-cache-loader.ts` currently gives up silently on a `stargazer_cache` miss (line 120: `if (!r.ok) { ...; return; }`, which is exactly the empty-map state the July 24 UI work (`bb179cd`) added a notice for). Insert `/api/reconstruct` then `/api/engaged` as fallbacks before that give-up, and track which source served the data so the UI never claims a degraded map is a full scan.

**Files:**
- Modify: `src/hooks/use-repo-cache-loader.ts:118-123` (the `if (!r.ok)` branch)
- Modify: `src/lib/stargazer-notice.ts` (add a second copy variant for "showing partial data", the current copy at line 24-29 only covers the zero-data case)
- Create: `src/components/map/data-source-badge.tsx`
- Test: `src/hooks/__tests__/use-repo-cache-loader.test.ts` (extend if it exists, create otherwise), `src/components/map/__tests__/data-source-badge.test.tsx`

**Interfaces:**
- Consumes: `GET /api/reconstruct/[owner]/[repo]` and `GET /api/engaged/[owner]/[repo]` from Tracks A and B.
- Produces: `useRepoCacheLoader` gains a `dataSource: "cache" | "reconstructed" | "engaged" | null` return field. `DataSourceBadge({ source }: { source: "reconstructed" | "engaged" })` renders a small pill, no props beyond `source`.

- [ ] **Step 1: Check the existing hook test file exists**

```bash
find src/hooks -iname "*use-repo-cache-loader*"
```

If a test file exists, read it fully before continuing, new tests must follow its existing mock setup (it likely mocks `global.fetch` and `@/lib/repo-cache`). If none exists, Step 2 creates one from scratch mirroring the `beforeEach`/`vi.spyOn(global, "fetch")` pattern documented in `.claude/rules/tdd-mandatory.md`.

- [ ] **Step 2: Write the failing test for the fallback chain**

```typescript
// src/hooks/__tests__/use-repo-cache-loader.test.ts (add to existing file, or create)
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRepoCacheLoader } from "@/hooks/use-repo-cache-loader";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noopDispatch = vi.fn();

describe("useRepoCacheLoader fallback chain", () => {
  it("falls back to /api/reconstruct when stargazer_cache 404s", async () => {
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/api/stargazer-cache/")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (u.includes("/api/reconstruct/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ points: [{ login: "a" }], unmapped: [], totalCount: 1 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { result } = renderHook(() =>
      useRepoCacheLoader({
        owner: "octocat", repo: "hello", repoInfo: null, dispatch: noopDispatch,
        setTotal: vi.fn(), setCachedAt: vi.fn(), setLatestStarredAt: vi.fn(), setStatus: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
    expect(noopDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set", points: [{ login: "a" }] }),
    );
  });

  it("falls back to /api/engaged when both stargazer_cache and /api/reconstruct 404", async () => {
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/api/engaged/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ points: [{ login: "c" }], unmapped: [], knownCount: 1, starCount: 500, channels: ["fork"] }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const { result } = renderHook(() =>
      useRepoCacheLoader({
        owner: "octocat", repo: "hello", repoInfo: null, dispatch: noopDispatch,
        setTotal: vi.fn(), setCachedAt: vi.fn(), setLatestStarredAt: vi.fn(), setStatus: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
    expect(result.current.dataSource).toBe("engaged");
  });

  it("dataSource stays null when every source 404s", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    const { result } = renderHook(() =>
      useRepoCacheLoader({
        owner: "octocat", repo: "hello", repoInfo: null, dispatch: noopDispatch,
        setTotal: vi.fn(), setCachedAt: vi.fn(), setLatestStarredAt: vi.fn(), setStatus: vi.fn(),
      }),
    );

    await waitFor(() => expect(result.current.cacheCheckDone).toBe(true));
    expect(result.current.dataSource).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `rtk vitest run src/hooks/__tests__/use-repo-cache-loader.test.ts`
Expected: FAIL, `result.current.dataSource` is `undefined`, hook doesn't call `/api/reconstruct` or `/api/engaged` yet.

- [ ] **Step 4: Implement the fallback chain**

In `src/hooks/use-repo-cache-loader.ts`, add `dataSource` to the `Result` type and state, then replace the `if (!r.ok)` branch (currently lines 120-123):

```typescript
// Add to the Result type (currently at line 33-36):
type Result = {
  cacheCheckDone: boolean;
  lastDbScan: string | null;
  dataSource: "cache" | "reconstructed" | "engaged" | null;
};

// Add state near the top of useRepoCacheLoader (near line 70-71):
const [dataSource, setDataSource] = useState<"cache" | "reconstructed" | "engaged" | null>(null);

// Replace the `if (!r.ok) { ...; return; }` branch (line 120-123) with:
if (!r.ok) {
  if (validLocal) {
    donateLocalCacheToDb(owner, repo, validLocal);
    return;
  }
  const reconstructRes = await fetch(`/api/reconstruct/${owner}/${repo}`, { signal: ac.signal });
  if (reconstructRes.ok) {
    const rd = await reconstructRes.json();
    dispatch({ type: "set", points: rd.points, unmapped: rd.unmapped });
    setTotal(rd.totalCount);
    setStatus("cached");
    setDataSource("reconstructed");
    return;
  }
  const engagedRes = await fetch(`/api/engaged/${owner}/${repo}`, { signal: ac.signal });
  if (engagedRes.ok) {
    const ed = await engagedRes.json();
    dispatch({ type: "set", points: ed.points, unmapped: ed.unmapped });
    setTotal(ed.knownCount);
    setStatus("cached");
    setDataSource("engaged");
    return;
  }
  return;
}
if (validLocal) setDataSource("cache");
```

Update the hook's return statement to include `dataSource`.

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk vitest run src/hooks/__tests__/use-repo-cache-loader.test.ts`
Expected: PASS, all 3 new tests plus existing ones unaffected.

- [ ] **Step 6: Write the failing test for the data-source badge**

```typescript
// src/components/map/__tests__/data-source-badge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "@/components/map/data-source-badge";

describe("DataSourceBadge", () => {
  it("labels reconstructed data honestly, not as a full scan", () => {
    render(<DataSourceBadge source="reconstructed" />);
    expect(screen.getByText(/reconstructed/i)).toBeInTheDocument();
  });

  it("labels engaged-community data with its own copy", () => {
    render(<DataSourceBadge source="engaged" />);
    expect(screen.getByText(/engaged community/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `rtk vitest run src/components/map/__tests__/data-source-badge.test.tsx`
Expected: FAIL, module not found

- [ ] **Step 8: Write the badge component**

```typescript
// src/components/map/data-source-badge.tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type Props = { source: "reconstructed" | "engaged" };

const COPY: Record<Props["source"], string> = {
  reconstructed: "Reconstructed from our own database, not a fresh scan",
  engaged: "Showing the engaged community (forkers, contributors), not stargazers",
};

export const DataSourceBadge = ({ source }: Props) => (
  <div className="bg-surface-alt border border-border-subtle text-muted-subtle text-xs px-2 py-1 rounded-md">
    {COPY[source]}
  </div>
);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `rtk vitest run src/components/map/__tests__/data-source-badge.test.tsx`
Expected: PASS, 2/2

- [ ] **Step 10: Wire `DataSourceBadge` into the repo page**

In `src/app/[owner]/[repo]/page.client.tsx`, destructure `dataSource` from `useRepoCacheLoader`'s return value and render `<DataSourceBadge source={dataSource} />` next to the existing stats panel when `dataSource === "reconstructed"` or `"engaged"`. Follow the existing conditional-render pattern already used for `RateLimitOverlay`/`PreScanOverlay` in the same file (both imported near line 17-18).

- [ ] **Step 11: Update `stargazer-notice.ts` copy**

The existing `STARGAZER_NOTICE_BODY` (line 24-29) says "I'm actively analysing what StarMapper can do next", now false, both fallbacks exist. Add a new export:

```typescript
export const STARGAZER_NOTICE_DEGRADED_BODY: readonly string[] = [
  "On June 30 2026 GitHub announced restrictions on public API endpoints and UI views. Since July 23 the restriction reached the stargazers list.",
  "This repo's map is not from a fresh stargazers scan. It's reconstructed from data StarMapper already holds, or built from the engaged community (forkers, contributors, issue and PR authors) instead. Both recover a slice of the real audience, not the full list.",
  "Follow the links below for the official sources, or see the open options at /roadmap.",
];
```

Leave `STARGAZER_NOTICE_BODY` as the zero-data variant (still accurate when every fallback also 404s).

- [ ] **Step 12: `rtk tsc` clean, run full suite, then commit**

```bash
rtk tsc
rtk vitest run
git add src/hooks/use-repo-cache-loader.ts src/hooks/__tests__/use-repo-cache-loader.test.ts \
  src/components/map/data-source-badge.tsx src/components/map/__tests__/data-source-badge.test.tsx \
  src/lib/stargazer-notice.ts "src/app/[owner]/[repo]/page.client.tsx"
git commit -m "feat(map): fall back to reconstruct/engaged data, label honestly"
```

---

## Task 4: Phase 2 coverage metric (Track D)

`docs/ROADMAP.md:84` specs `0.3 * N / M` (N = distinct logins in `star_event` for the repo, M = live `stargazerCount`) instead of raw `N/M`, which overstates coverage ~3x since only 30% of `github_user` rows are geolocated. Neither the `BadgeCache.knownCount`/`coverageComputedAt` columns nor the computation exist yet.

**Files:**
- Modify: `prisma/schema.prisma` (add `knownCount Int?` and `coverageComputedAt DateTime?` to `BadgeCache`, around line 17-32)
- Create: `src/lib/coverage.ts`
- Test: `src/lib/__tests__/coverage.test.ts`

**Interfaces:**
- Produces: `computeCoverage(knownCount: number, liveStarCount: number): number`, returns a 0-100 integer, clamped, using the `0.3 * N / M` formula.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/coverage.test.ts
import { describe, it, expect } from "vitest";
import { computeCoverage } from "@/lib/coverage";

describe("computeCoverage", () => {
  it("applies the 0.3 geolocation-rate factor, not raw N/M", () => {
    // N=1000, M=1000 → raw would be 100%, weighted should be 30%
    expect(computeCoverage(1000, 1000)).toBe(30);
  });

  it("clamps at 100 when the weighted ratio would exceed it", () => {
    expect(computeCoverage(10000, 1000)).toBe(100);
  });

  it("returns 0 when liveStarCount is 0", () => {
    expect(computeCoverage(500, 0)).toBe(0);
  });

  it("rounds to the nearest integer", () => {
    expect(computeCoverage(333, 1000)).toBe(10); // 0.3 * 333/1000 = 9.99 → 10
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk vitest run src/lib/__tests__/coverage.test.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/coverage.ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Weighted coverage: raw distinct-login-count / live-star-count overstates what
// actually renders as a dot by roughly 3x, since only ~30% of github_user rows
// carry a geolocation. See docs/ROADMAP.md Phase 2 for the measurement.
const GEOLOCATION_RATE = 0.3;

export const computeCoverage = (knownCount: number, liveStarCount: number): number => {
  if (liveStarCount <= 0) return 0;
  const raw = GEOLOCATION_RATE * (knownCount / liveStarCount) * 100;
  return Math.min(100, Math.round(raw));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk vitest run src/lib/__tests__/coverage.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Add the schema columns**

In `prisma/schema.prisma`, inside `model BadgeCache` (starts line 17), add after `organicComputedAt`:

```prisma
  knownCount         Int?
  coverageComputedAt DateTime?
```

```bash
npx prisma db push
npx prisma generate
rtk tsc
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/coverage.ts src/lib/__tests__/coverage.test.ts
git commit -m "feat(db): add coverage metric fields and weighted formula"
```

*(Wiring `computeCoverage` into the stats panel UI and a write path that populates `knownCount`/`coverageComputedAt` is follow-up scope once Track C's fallback chain is live and there's real `dataSource` traffic to measure. Do not build the write path speculatively before Track C ships.)*

---

## Task 90: legal ToS read for Phase 3, not code, not dispatched (Track E)

`docs/ROADMAP.md:100` ranks this risk #1, BLOCKER: *"Pooling GraphQL quota across 3 accounts and 4 tokens is itself ToS-fragile... A legal/ToS read is required before Phase 3, this is not something to engineer around."* Checked during this planning pass: `claudedocs/audit-rgpd-legal-2026-04-17.md` (the only existing legal doc) has zero mentions of `starredRepositories`, pooling, or circumvention. It covers the stargazer-list scraping question only, not the crawler's multi-account quota-pooling question. No document answers this. Phase 0's own gate is already clear (`before-after-and-poc-plan.md`: 94.4% median leave-one-out recovery, threshold was 20%), so the crawler is blocked on this alone.

**Action, not a task list:** get a real legal read (external counsel or a documented risk-acceptance decision from Florian) on whether pooling GraphQL quota across the existing 4 `GITHUB_TOKEN` slots for a `starredRepositories` crawl breaches GitHub's ToS in a way that risks all 4 tokens and their accounts. Until that lands, Phase 3 does not start, no task in this plan touches `scripts/crawl-user-stars.ts` or the `user_star_crawl` table.

---

## Task 5: resync `/roadmap` page copy (Track F, after Tasks 1-3 ship)

Once Track C is live, option A's public claim ("Already shipping") stops being misleading, since the engaged-audience map becomes something a visitor can actually see. Do this last, not first: resyncing copy before the feature is visible just moves the same overclaim from README to `/roadmap`.

**Files:**
- Modify: `src/lib/roadmap-vote-copy.ts:22-24` (option A's `sentence`)

- [ ] **Step 1: Update option A's copy once Track C has shipped**

Change the `sentence` field for `option: "A"` (currently line 24) from describing early-run recovery numbers only, to also state that the map is now visible on affected repo pages, e.g.: append `" Now visible directly on any affected repo's map page, labeled honestly as engaged-community data, not a stargazer count."`

- [ ] **Step 2: Commit**

```bash
git add src/lib/roadmap-vote-copy.ts
git commit -m "docs(roadmap): update option A copy now the map is visible"
```

*Option D (freeze pre-cutoff data as a citable archive) has zero implementation behind its "Already planned" claim on the public page. Out of scope for this plan, raise with Florian whether to build it (export the 2642 already-cached repos as a dated public dataset) or soften the claim on `/roadmap` to "planned" without the "Already".*

---

## Task 91: Self-Review notes, not a task

**Spec coverage:** Track A covers making `EngagedCache` readable (the immediate gap found this session). Track B covers ROADMAP.md Phase 1 (explicitly "does not wait on Phase 3"). Track C covers the actual user-visible wiring both A and B need to matter at all, plus the honesty requirement (never label degraded data as a full scan). Track D covers ROADMAP.md Phase 2. Track E surfaces the Phase 3 BLOCKER as an explicit non-engineering action instead of leaving it silent in a doc. Track F closes the roadmap-page/reality gap flagged earlier this session, sequenced after the feature actually ships.

**Placeholder scan:** No TBD/TODO. Every code step has real, complete code. Track D's write-path note is an explicit scope boundary (YAGNI, no consumer exists yet), not a placeholder.

**Type consistency:** `StargazerPoint`-shaped objects (`login`, `name`, `bio`, `company`, `location`, `followers`, `avatarUrl`, `lat`, `lng`, `starredAt`, `linkedinUrl`) match `src/app/api/chunk/route.ts:20-32` across Tracks A, B, and C. `dataSource` type (`"cache" | "reconstructed" | "engaged" | null`) is consistent between the hook (Track C Step 4) and `DataSourceBadge`'s prop type (Track C Step 8, narrowed to the two non-null degraded states since `null`/`"cache"` never render the badge).
