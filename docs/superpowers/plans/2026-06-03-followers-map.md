# Followers Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/[login]/followers` page that maps GitHub followers of any user on an interactive world map, with a side panel listing all followers (avatar, login, location, mapped/unmapped badge).

**Architecture:** New API route `/api/followers-chunk` mirrors `/api/chunk` but fetches `user.followers` via GitHub GraphQL instead of `repository.stargazers`. A new page `/[owner]/followers/` runs the same chunk-loop pattern client-side, accumulating points progressively. A `FollowersPanel` component provides a persistent side list with virtual scroll alongside the map.

**Tech Stack:** Next.js 16 App Router · TypeScript 5 · GitHub GraphQL API · MapLibre GL 5 · Tailwind v4 · Vitest

---

## File Map

| Status | Path | Responsibility |
|--------|------|----------------|
| **Modify** | `src/lib/github.ts` | Add `fetchFollowersPage(login, cursor, clientToken)` + `FollowerRaw` + `FollowersPage` types |
| **Create** | `src/schemas/followers-chunk.ts` | Zod schema for POST body: `{ login, cursor? }` |
| **Create** | `src/app/api/followers-chunk/route.ts` | POST handler: GitHub fetch + geocode + JSON response |
| **Create** | `src/hooks/useFollowersScanController.ts` | Client chunk loop for followers (mirrors `useScanController`) |
| **Create** | `src/components/map/followers-panel.tsx` | Persistent side panel: list + search + fly-to |
| **Create** | `src/app/[owner]/followers/page.tsx` | Server component: metadata + Suspense wrapper |
| **Create** | `src/app/[owner]/followers/page.client.tsx` | Client component: map + panel + scan state |
| **Modify** | `src/app/[owner]/page.client.tsx` | Add "Followers map" link on profile page |
| **Modify** | `src/lib/github.test.ts` | Tests for `fetchFollowersPage` |
| **Create** | `src/app/api/followers-chunk/route.test.ts` | Integration tests for the route |

---

### Task 1: Add `fetchFollowersPage` to `src/lib/github.ts`

**Files:**
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github.test.ts`

- [ ] **Step 1.1: Write failing tests**

Add to the bottom of `src/lib/github.test.ts` (after the existing `fetchStargazersPage` describe block):

```ts
import { fetchFollowersPage } from "@/lib/github";

// ─── Fixtures for followers ───────────────────────────────────────────────────

type FollowerNodeOverride = {
  login?: string;
  location?: string | null;
};

const makeFollowerNode = (o: FollowerNodeOverride = {}) => ({
  login: o.login ?? "octocat",
  name: "The Octocat",
  bio: null,
  company: null,
  location: o.location !== undefined ? o.location : "San Francisco, CA",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  createdAt: "2011-01-25T18:44:36Z",
  followers: { totalCount: 100 },
  following: { totalCount: 10 },
  repositories: { totalCount: 50 },
});

const makeFollowersResponse = (overrides: {
  nodes?: ReturnType<typeof makeFollowerNode>[];
  hasNextPage?: boolean;
  endCursor?: string | null;
  totalCount?: number;
} = {}) => ({
  data: {
    user: {
      followers: {
        pageInfo: {
          hasNextPage: overrides.hasNextPage ?? false,
          endCursor: overrides.endCursor ?? null,
        },
        nodes: overrides.nodes ?? [makeFollowerNode()],
        totalCount: overrides.totalCount ?? 1,
      },
    },
  },
});

describe("fetchFollowersPage()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns followers with correct fields", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    const page = await fetchFollowersPage("octocat", null);
    expect(page.followers).toHaveLength(1);
    expect(page.followers[0].login).toBe("octocat");
    expect(page.followers[0].location).toBe("San Francisco, CA");
    expect(page.followers[0].followers).toBe(100);
    expect(page.totalCount).toBe(1);
    expect(page.nextCursor).toBeNull();
  });

  it("returns nextCursor when hasNextPage is true", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeFollowersResponse({ hasNextPage: true, endCursor: "cursor123" })),
    );
    const page = await fetchFollowersPage("octocat", null);
    expect(page.nextCursor).toBe("cursor123");
  });

  it("returns null nextCursor when hasNextPage is false", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse({ hasNextPage: false })));
    const page = await fetchFollowersPage("octocat", null);
    expect(page.nextCursor).toBeNull();
  });

  it("passes cursor variable when provided", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    await fetchFollowersPage("octocat", "cursor_abc");
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.variables.cursor).toBe("cursor_abc");
  });

  it("omits cursor variable when null", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchOk(makeFollowersResponse()));
    await fetchFollowersPage("octocat", null);
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.variables.cursor).toBeUndefined();
  });

  it("throws GitHubRateLimitError on 403", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchError(403, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) }),
    );
    await expect(fetchFollowersPage("octocat", null)).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it("throws GitHubTokenInvalidError on 401", async () => {
    vi.mocked(fetch).mockReturnValue(mockFetchError(401));
    await expect(fetchFollowersPage("octocat", null)).rejects.toBeInstanceOf(GitHubTokenInvalidError);
  });

  it("extracts quotaRemaining from x-ratelimit-remaining header", async () => {
    vi.mocked(fetch).mockReturnValue(
      mockFetchOk(makeFollowersResponse(), { "x-ratelimit-remaining": "4800" }),
    );
    const page = await fetchFollowersPage("octocat", null);
    expect(page.quotaRemaining).toBe(4800);
  });
});
```

- [ ] **Step 1.2: Run tests: confirm failure**

```bash
rtk vitest run src/lib/github.test.ts
```

Expected: FAIL: `fetchFollowersPage is not exported from "@/lib/github"`

- [ ] **Step 1.3: Add types and function to `src/lib/github.ts`**

Add after the `StargazersPage` type (around line 40), before `fetchStargazersPage`:

```ts
export type FollowerRaw = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  accountCreatedAt: string | null;
  avatarUrl: string;
};

export type FollowersPage = {
  followers: FollowerRaw[];
  nextCursor: string | null;
  totalCount: number;
  quotaRemaining: number | null;
};
```

Add after `fetchStargazersPage` (at the end of the file):

```ts
export const fetchFollowersPage = async (
  login: string,
  cursor: string | null,
  clientToken?: string,
): Promise<FollowersPage> => {
  const token = clientToken || process.env.GITHUB_TOKEN;
  const query = `
    query($login: String!, $cursor: String) {
      user(login: $login) {
        followers(first: 100, after: $cursor) {
          nodes {
            login
            name
            bio
            company
            location
            avatarUrl
            createdAt
            followers { totalCount }
            following { totalCount }
            repositories(first: 0) { totalCount }
          }
          pageInfo { hasNextPage endCursor }
          totalCount
        }
      }
    }
  `;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: cursor ? { login, cursor } : { login },
    }),
  });

  if (!res.ok && (res.status === 403 || res.status === 429)) {
    const resetEpoch = res.headers.get("x-ratelimit-reset");
    const retryAfter = res.headers.get("retry-after");
    let resetAt: number;
    if (retryAfter) {
      resetAt = Date.now() + parseInt(retryAfter, 10) * 1000;
    } else if (resetEpoch) {
      resetAt = parseInt(resetEpoch, 10) * 1000;
    } else {
      resetAt = Date.now() + 60_000;
    }
    throw new GitHubRateLimitError(resetAt);
  }
  if (res.status === 401) throw new GitHubTokenInvalidError();
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const quotaRemaining = (() => {
    const raw = res.headers.get("x-ratelimit-remaining");
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  })();

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  const data = json.data.user.followers;

  const followers: FollowerRaw[] = (data.nodes as Array<{
    login: string; name: string | null; bio: string | null; company: string | null;
    location: string | null; avatarUrl: string; createdAt: string | null;
    followers: { totalCount: number }; following: { totalCount: number };
    repositories: { totalCount: number };
  }>).map((node) => ({
    login: node.login,
    name: node.name ?? null,
    bio: node.bio ?? null,
    company: node.company ? node.company.trim().replace(/^@/, "") : null,
    location: node.location ?? null,
    followers: node.followers.totalCount,
    following: node.following.totalCount,
    publicRepos: node.repositories.totalCount,
    accountCreatedAt: node.createdAt ?? null,
    avatarUrl: node.avatarUrl,
  }));

  return {
    totalCount: data.totalCount,
    nextCursor: data.pageInfo.hasNextPage ? (data.pageInfo.endCursor as string) : null,
    followers,
    quotaRemaining,
  };
};
```

- [ ] **Step 1.4: Run tests: confirm pass**

```bash
rtk vitest run src/lib/github.test.ts
```

Expected: All `fetchFollowersPage()` tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/github.ts src/lib/github.test.ts
git commit -m "feat(github): add fetchFollowersPage for user followers GraphQL query"
```

---

### Task 2: Create Zod schema `src/schemas/followers-chunk.ts`

**Files:**
- Create: `src/schemas/followers-chunk.ts`

- [ ] **Step 2.1: Create the schema file**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

export const followersChunkSchema = z.object({
  login: z
    .string({ error: "Invalid login format" })
    .regex(OWNER_REPO_RE, "Invalid login format")
    .transform((s) => s.toLowerCase()),
  cursor: z
    .union([z.string({ error: "Invalid cursor" }).max(1000, "Invalid cursor"), z.null()])
    .optional(),
});

export type FollowersChunkBody = z.infer<typeof followersChunkSchema>;
```

- [ ] **Step 2.2: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/schemas/followers-chunk.ts
git commit -m "feat(api): add followers-chunk Zod schema"
```

---

### Task 3: Create `POST /api/followers-chunk` route

**Files:**
- Create: `src/app/api/followers-chunk/route.ts`
- Create: `src/app/api/followers-chunk/route.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `src/app/api/followers-chunk/route.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/geocoder", () => ({
  geocodeBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/user-cache", () => ({
  bulkReadUsers: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/github", () => ({
  fetchFollowersPage: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) { super("rate_limited"); this.resetAt = resetAt; }
  },
  GitHubTokenInvalidError: class GitHubTokenInvalidError extends Error {
    constructor() { super("token_invalid"); }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    limit = vi.fn().mockResolvedValue({ success: true });
    static slidingWindow = vi.fn().mockReturnValue({});
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: vi.fn((fn: () => void) => fn()) };
});

import { POST } from "@/app/api/followers-chunk/route";
import { fetchFollowersPage } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";

const makeFollowerRaw = (login = "alice", location: string | null = "Paris, France") => ({
  login,
  name: login,
  bio: null,
  company: null,
  location,
  followers: 42,
  following: 10,
  publicRepos: 5,
  accountCreatedAt: "2020-01-01T00:00:00Z",
  avatarUrl: `https://avatars.githubusercontent.com/u/1`,
});

const makeRequest = (body: object) =>
  new NextRequest("http://localhost/api/followers-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/followers-chunk", () => {
  beforeEach(() => {
    vi.mocked(fetchFollowersPage).mockResolvedValue({
      followers: [makeFollowerRaw()],
      nextCursor: null,
      totalCount: 1,
      quotaRemaining: 4900,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with points when geocoding succeeds", async () => {
    vi.mocked(geocodeBatch).mockResolvedValue(new Map([["paris, france", [48.85, 2.35]]]));
    const res = await POST(makeRequest({ login: "octocat" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toHaveLength(1);
    expect(body.unmapped).toHaveLength(0);
    expect(body.points[0].login).toBe("alice");
    expect(body.nextCursor).toBeNull();
    expect(body.totalCount).toBe(1);
  });

  it("puts followers without location into unmapped", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue({
      followers: [makeFollowerRaw("bob", null)],
      nextCursor: null,
      totalCount: 1,
      quotaRemaining: null,
    });
    const res = await POST(makeRequest({ login: "octocat" }));
    const body = await res.json();
    expect(body.points).toHaveLength(0);
    expect(body.unmapped).toHaveLength(1);
    expect(body.unmapped[0].login).toBe("bob");
    expect(body.unmapped[0].avatarUrl).toBeDefined();
  });

  it("puts followers with unresolvable location into unmapped", async () => {
    vi.mocked(geocodeBatch).mockResolvedValue(new Map());
    const res = await POST(makeRequest({ login: "octocat" }));
    const body = await res.json();
    expect(body.points).toHaveLength(0);
    expect(body.unmapped).toHaveLength(1);
  });

  it("returns 400 on invalid login", async () => {
    const res = await POST(makeRequest({ login: "../../evil" }));
    expect(res.status).toBe(400);
  });

  it("returns 429 on GitHub rate limit", async () => {
    const { GitHubRateLimitError } = await import("@/lib/github");
    vi.mocked(fetchFollowersPage).mockRejectedValue(new GitHubRateLimitError(Date.now() + 60_000));
    const res = await POST(makeRequest({ login: "octocat" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.resetAt).toBeTypeOf("number");
  });

  it("returns 401 on invalid token", async () => {
    const { GitHubTokenInvalidError } = await import("@/lib/github");
    vi.mocked(fetchFollowersPage).mockRejectedValue(new GitHubTokenInvalidError());
    const res = await POST(makeRequest({ login: "octocat" }));
    expect(res.status).toBe(401);
  });

  it("includes avatarUrl in unmapped entry", async () => {
    vi.mocked(fetchFollowersPage).mockResolvedValue({
      followers: [makeFollowerRaw("carol", null)],
      nextCursor: null,
      totalCount: 1,
      quotaRemaining: null,
    });
    const res = await POST(makeRequest({ login: "octocat" }));
    const body = await res.json();
    expect(body.unmapped[0].avatarUrl).toBe("https://avatars.githubusercontent.com/u/1");
  });
});
```

- [ ] **Step 3.2: Run tests: confirm failure**

```bash
rtk vitest run src/app/api/followers-chunk/route.test.ts
```

Expected: FAIL: cannot find module `@/app/api/followers-chunk/route`

- [ ] **Step 3.3: Create the route**

Create `src/app/api/followers-chunk/route.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { fetchFollowersPage, GitHubRateLimitError, GitHubTokenInvalidError } from "@/lib/github";
import { geocodeBatch } from "@/lib/geocoder";
import { bulkReadUsers } from "@/lib/user-cache";
import { jsonError, extractGhToken, logError, sanitizeError, getIP } from "@/lib/api-helpers";
import { hashApiKey } from "@/lib/api-key";
import { defineRoute } from "@/lib/define-route";
import { followersChunkSchema } from "@/schemas/followers-chunk";

export type FollowerPoint = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  avatarUrl: string;
  lat: number;
  lng: number;
};

export type FollowersChunkResponse = {
  points: FollowerPoint[];
  unmapped: { login: string; name: string | null; followers: number; avatarUrl: string }[];
  nextCursor: string | null;
  totalCount: number;
  quotaRemaining: number | null;
};

let _limiter: Ratelimit | null = null;
let _limiterReady = false;
const getLimiter = (): Ratelimit | null => {
  if (_limiterReady) return _limiter;
  _limiterReady = true;
  try {
    _limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:followers-chunk",
    });
  } catch {
    _limiter = null;
  }
  return _limiter;
};

let _patLimiter: Ratelimit | null = null;
let _patLimiterReady = false;
const getPatLimiter = (): Ratelimit | null => {
  if (_patLimiterReady) return _patLimiter;
  _patLimiterReady = true;
  try {
    _patLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(300, "60 m"),
      prefix: "rl:followers-chunk-pat",
    });
  } catch {
    _patLimiter = null;
  }
  return _patLimiter;
};

let activeSessions = 0;
const MAX_CONCURRENT = 3;

export const POST = async (req: NextRequest) => {
  const limiter = getLimiter();
  if (limiter) {
    const { success } = await limiter.limit(getIP(req));
    if (!success) return jsonError("Rate limit exceeded. Retry in a few seconds.", 429);
  }

  const clientPat = req.headers.get("x-gh-token");
  if (clientPat) {
    const patLimiter = getPatLimiter();
    if (patLimiter) {
      const { success } = await patLimiter.limit(hashApiKey(clientPat));
      if (!success) return jsonError("Rate limit exceeded. Retry in a few minutes.", 429);
    }
  }

  if (activeSessions >= MAX_CONCURRENT) {
    return jsonError("Server busy. Too many concurrent scans. Retry in a few seconds.", 429);
  }

  activeSessions++;
  try {
    return await defineRoute(followersChunkSchema, async (_req, body) => {
      const clientToken = extractGhToken(req);
      const page = await fetchFollowersPage(body.login, body.cursor ?? null, clientToken);

      const STALE_MS = 30 * 24 * 60 * 60 * 1000;
      const logins = page.followers.map((f) => f.login);
      const knownUsers = await bulkReadUsers(logins);

      const locationsToGeocode = page.followers
        .filter((f) => {
          const known = knownUsers.get(f.login);
          if (!known) return true;
          const isStale = Date.now() - known.fetchedAt.getTime() > STALE_MS;
          const locationChanged = known.location !== (f.location ?? null);
          return isStale || locationChanged;
        })
        .map((f) => f.location ?? "")
        .filter(Boolean);

      const geoMap = await geocodeBatch(locationsToGeocode);

      const points: FollowerPoint[] = [];
      const unmapped: FollowersChunkResponse["unmapped"] = [];

      for (const f of page.followers) {
        const known = knownUsers.get(f.login);
        const loc = f.location ?? "";

        let coords: [number, number] | null = null;
        if (
          known?.lat !== null && known?.lat !== undefined &&
          known?.lng !== null && known?.lng !== undefined &&
          known.location === loc
        ) {
          coords = [known.lat, known.lng];
        } else if (loc) {
          const geo = geoMap.get(loc) ?? null;
          coords = geo;
        }

        if (coords) {
          points.push({
            login: f.login,
            name: f.name,
            bio: f.bio,
            company: f.company,
            location: f.location,
            followers: f.followers,
            avatarUrl: f.avatarUrl,
            lat: Math.round(coords[0] * 100) / 100,
            lng: Math.round(coords[1] * 100) / 100,
          });
        } else {
          unmapped.push({
            login: f.login,
            name: f.name,
            followers: f.followers,
            avatarUrl: f.avatarUrl,
          });
        }
      }

      return NextResponse.json({
        points,
        unmapped,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        quotaRemaining: page.quotaRemaining,
      } satisfies FollowersChunkResponse);
    })(req);
  } catch (err: unknown) {
    if (err instanceof GitHubTokenInvalidError) {
      return NextResponse.json({ error: "github_token_invalid" }, { status: 401 });
    }
    if (err instanceof GitHubRateLimitError) {
      return NextResponse.json({ error: "rate_limited", resetAt: err.resetAt }, { status: 429 });
    }
    logError("followers-chunk", err);
    const msg =
      err instanceof Error && err.message.startsWith("GitHub API error")
        ? sanitizeError(err)
        : "internal";
    return jsonError(msg, 500);
  } finally {
    activeSessions--;
  }
};
```

- [ ] **Step 3.4: Run tests: confirm pass**

```bash
rtk vitest run src/app/api/followers-chunk/route.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/app/api/followers-chunk/ src/schemas/followers-chunk.ts
git commit -m "feat(api): add POST /api/followers-chunk with geocoding and rate limiting"
```

---

### Task 4: Create `useFollowersScanController` hook

**Files:**
- Create: `src/hooks/useFollowersScanController.ts`

- [ ] **Step 4.1: Create the hook**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useCallback, useRef, useState, startTransition } from "react";
import type { FollowerPoint, FollowersChunkResponse } from "@/app/api/followers-chunk/route";
import { getStoredToken, setStoredToken } from "@/lib/token";

export type UnmappedFollowerEntry = {
  login: string;
  name: string | null;
  followers: number;
  avatarUrl: string;
};

export type FollowersScanState = {
  points: FollowerPoint[];
  unmapped: UnmappedFollowerEntry[];
  processed: number;
};

export type FollowersScanAction =
  | { type: "reset" }
  | { type: "chunk"; points: FollowerPoint[]; unmapped: UnmappedFollowerEntry[] };

export const followersScanReducer = (
  state: FollowersScanState,
  action: FollowersScanAction,
): FollowersScanState => {
  switch (action.type) {
    case "reset":
      return { points: [], unmapped: [], processed: 0 };
    case "chunk":
      return {
        points: action.points,
        unmapped: action.unmapped,
        processed: action.points.length + action.unmapped.length,
      };
    default:
      return state;
  }
};

class RateLimitedError extends Error {
  resetAt: number;
  reason: "github" | "server";
  constructor(resetAt: number, reason: "github" | "server" = "server") {
    super("rate_limited");
    this.resetAt = resetAt;
    this.reason = reason;
  }
}

class TokenInvalidError extends Error {
  constructor() {
    super("token_invalid");
  }
}

export type FollowersScanStatus = "idle" | "loading" | "waiting" | "done" | "error";

type UseFollowersScanControllerOptions = {
  login: string;
  dispatch: React.Dispatch<FollowersScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setTokenOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHasToken: React.Dispatch<React.SetStateAction<boolean>>;
  ghHeaders: () => Record<string, string>;
};

export const useFollowersScanController = ({
  login,
  dispatch,
  setTotal,
  setTokenOpen,
  setHasToken,
  ghHeaders,
}: UseFollowersScanControllerOptions) => {
  const [status, setStatus] = useState<FollowersScanStatus>("idle");
  const [retryIn, setRetryIn] = useState(0);
  const [retryTotal, setRetryTotal] = useState(0);
  const [waitReason, setWaitReason] = useState<"github" | "server">("server");
  const [error, setError] = useState("");
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const runningRef = useRef(false);
  const pendingScanRef = useRef(false);

  const fetchNextChunk = useCallback(
    async (cursor: string | null) => {
      const res = await fetch("/api/followers-chunk", {
        method: "POST",
        headers: ghHeaders(),
        body: JSON.stringify({ login, cursor }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { resetAt?: number };
        throw new RateLimitedError(
          body.resetAt ?? Date.now() + 60_000,
          body.resetAt ? "github" : "server",
        );
      }
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (body.error === "github_token_invalid") throw new TokenInvalidError();
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as FollowersChunkResponse;
    },
    [login, ghHeaders],
  );

  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    dispatch({ type: "reset" });
    setStatus("loading");
    let cursor: string | null = null;
    let allPoints: FollowerPoint[] = [];
    let allUnmapped: UnmappedFollowerEntry[] = [];

    try {
      while (true) {
        let chunk: FollowersChunkResponse;
        while (true) {
          try {
            chunk = await fetchNextChunk(cursor);
            break;
          } catch (e) {
            if (e instanceof RateLimitedError) {
              const secsLeft = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000));
              setWaitReason(e.reason);
              setStatus("waiting");
              setRetryIn(secsLeft);
              setRetryTotal(secsLeft);
              await new Promise((r) => setTimeout(r, secsLeft * 1000));
              setStatus("loading");
            } else if (e instanceof TokenInvalidError) {
              setStoredToken("");
              setHasToken(false);
            } else {
              throw e;
            }
          }
        }

        if (chunk!.quotaRemaining !== null && chunk!.quotaRemaining !== undefined) {
          setQuotaRemaining(chunk!.quotaRemaining);
        }
        setTotal(chunk!.totalCount);
        allPoints = allPoints.concat(chunk!.points);
        allUnmapped = allUnmapped.concat(chunk!.unmapped);
        startTransition(() => {
          dispatch({ type: "chunk", points: allPoints, unmapped: allUnmapped });
        });
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [fetchNextChunk, dispatch, setTotal, setHasToken]);

  const handleStartScan = useCallback(() => {
    if (!getStoredToken()) {
      pendingScanRef.current = true;
      setTokenOpen(true);
      return;
    }
    startScraping();
  }, [startScraping, setTokenOpen]);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
    if (pendingScanRef.current) {
      pendingScanRef.current = false;
      if (getStoredToken()) startScraping();
    }
  }, [startScraping, setTokenOpen, setHasToken]);

  return {
    status,
    retryIn,
    retryTotal,
    waitReason,
    error,
    quotaRemaining,
    startScraping,
    handleStartScan,
    handleTokenClose,
    runningRef,
  };
};
```

- [ ] **Step 4.2: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/hooks/useFollowersScanController.ts
git commit -m "feat(hooks): add useFollowersScanController for followers chunk loop"
```

---

### Task 5: Create `FollowersPanel` component

**Files:**
- Create: `src/components/map/followers-panel.tsx`

- [ ] **Step 5.1: Create the component**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { X, Search, MapPin } from "lucide-react";
import type { FollowerPoint } from "@/app/api/followers-chunk/route";
import type { UnmappedFollowerEntry } from "@/hooks/useFollowersScanController";

type AnyFollower = {
  login: string;
  name: string | null;
  followers: number;
  avatarUrl: string;
  location: string | null;
  mapped: boolean;
};

type FollowersPanelProps = {
  open: boolean;
  onClose: () => void;
  points: FollowerPoint[];
  unmapped: UnmappedFollowerEntry[];
  setFlyTarget: (target: { lat: number; lng: number; login: string } | null) => void;
};

const ROW_H = 52;
const OVERSCAN = 5;

export const FollowersPanel = ({
  open,
  onClose,
  points,
  unmapped,
  setFlyTarget,
}: FollowersPanelProps) => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useState<"all" | "mapped" | "unmapped">("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allFollowers = useMemo<AnyFollower[]>(
    () => [
      ...points.map((p) => ({
        login: p.login,
        name: p.name,
        followers: p.followers,
        avatarUrl: p.avatarUrl,
        location: p.location,
        mapped: true,
      })),
      ...unmapped.map((u) => ({
        login: u.login,
        name: u.name,
        followers: u.followers,
        avatarUrl: u.avatarUrl,
        location: null,
        mapped: false,
      })),
    ],
    [points, unmapped],
  );

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    return allFollowers
      .filter((f) => {
        if (filter === "mapped" && !f.mapped) return false;
        if (filter === "unmapped" && f.mapped) return false;
        if (!q) return true;
        return (
          f.login.toLowerCase().includes(q) ||
          (f.name?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => b.followers - a.followers);
  }, [allFollowers, deferredSearch, filter]);

  const totalRows = filtered.length;
  const visibleCount = Math.ceil(containerH / ROW_H) + OVERSCAN * 2;
  const vStart = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const vEnd = Math.min(totalRows, vStart + visibleCount);
  const visible = filtered.slice(vStart, vEnd);
  const padTop = vStart * ROW_H;
  const padBottom = (totalRows - vEnd) * ROW_H;

  return (
    <>
      {open && (
        <div
          className="absolute inset-0 z-20 bg-background/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        role="complementary"
        aria-label="Followers list"
        className={[
          "absolute z-20 bg-background/95 border-border backdrop-blur-md flex flex-col",
          "transition-transform duration-200",
          /* Mobile: bottom sheet */
          "bottom-0 left-0 right-0 max-h-[80dvh] rounded-t-2xl border-t",
          /* Desktop: right panel */
          "md:top-0 md:right-0 md:bottom-0 md:left-auto md:w-80 md:max-h-none md:rounded-none md:border-t-0 md:border-l",
          open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:translate-x-full",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Followers</span>
            <span className="bg-border text-muted text-xs px-1.5 py-px rounded-full tabular-nums">
              {allFollowers.length.toLocaleString()}
            </span>
          </div>
          <div className="flex gap-1">
            {(["all", "mapped", "unmapped"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                aria-pressed={filter === v}
                className={[
                  "px-2 py-0.5 rounded text-xs transition-colors",
                  filter === v
                    ? "bg-accent-blue/15 text-accent-blue"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                {v === "all" ? "All" : v === "mapped" ? "On map" : "No location"}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            aria-label="Close followers list"
            className="text-muted hover:text-foreground transition-colors ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-border-subtle flex-shrink-0">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by login or name…"
              aria-label="Search followers"
              className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30"
            />
          </div>
        </div>

        {/* Virtual list */}
        <div
          ref={listRef}
          className="overflow-y-auto flex-1"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {padTop > 0 && <div style={{ height: padTop }} />}

          {visible.map((f) => (
            <div
              key={f.login}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle hover:bg-surface transition-colors group"
              style={{ height: ROW_H }}
            >
              {f.avatarUrl ? (
                <img
                  src={f.avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="size-7 rounded-full bg-surface-alt flex-shrink-0 flex items-center justify-center text-xs font-medium text-muted">
                  {f.login[0].toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <a
                  href={`https://github.com/${f.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue text-xs font-medium hover:underline block truncate"
                >
                  @{f.login}
                </a>
                {f.name && (
                  <div className="text-xs text-muted truncate">{f.name}</div>
                )}
              </div>

              {f.followers >= 100 && (
                <span
                  className={[
                    "text-xs tabular-nums flex-shrink-0",
                    f.followers >= 1000 ? "text-accent-orange" : "text-muted",
                  ].join(" ")}
                >
                  {f.followers >= 1000
                    ? `${(f.followers / 1000).toFixed(1)}k`
                    : f.followers}
                </span>
              )}

              {f.mapped ? (
                <button
                  onClick={() => {
                    const pt = points.find((p) => p.login === f.login);
                    if (pt) setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login });
                  }}
                  aria-label={`Show ${f.login} on map`}
                  className="text-accent-green opacity-0 group-hover:opacity-100 hover:scale-110 transition-all flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <MapPin size={12} aria-hidden="true" />
                </button>
              ) : (
                <span
                  className="size-1.5 rounded-full bg-border flex-shrink-0"
                  aria-label="No location"
                />
              )}
            </div>
          ))}

          {padBottom > 0 && <div style={{ height: padBottom }} />}

          {filtered.length === 0 && (
            <div className="flex items-center justify-center h-24 text-xs text-muted">
              No followers found
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
```

- [ ] **Step 5.2: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/map/followers-panel.tsx
git commit -m "feat(ui): add FollowersPanel side panel with virtual scroll and fly-to"
```

---

### Task 6: Create the followers page

**Files:**
- Create: `src/app/[owner]/followers/page.tsx`
- Create: `src/app/[owner]/followers/page.client.tsx`

- [ ] **Step 6.1: Create the server component**

Create `src/app/[owner]/followers/page.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import FollowersPageClient from "./page.client";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> => {
  const { owner } = await params;
  return {
    title: `${owner}'s followers | StarMapper`,
    description: `Map of ${owner}'s GitHub followers around the world.`,
    alternates: { canonical: `/${owner}/followers` },
    openGraph: {
      title: `${owner}'s followers | StarMapper`,
      description: `Map of ${owner}'s GitHub followers around the world.`,
      type: "profile",
    },
    twitter: { card: "summary_large_image" },
  };
};

export default function FollowersPage({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <FollowersPageClient params={params} />
    </Suspense>
  );
}
```

- [ ] **Step 6.2: Create the client component**

Create `src/app/[owner]/followers/page.client.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useCallback, useMemo, useReducer, useState } from "react";
import dynamic from "next/dynamic";
import { followersScanReducer, useFollowersScanController } from "@/hooks/useFollowersScanController";
import type { FollowerPoint } from "@/app/api/followers-chunk/route";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { getStoredToken } from "@/lib/token";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/map-style-urls";
import { useTheme } from "@/hooks/useTheme";
import { FollowersPanel } from "@/components/map/followers-panel";
import { Users } from "lucide-react";

const StargazerMapDynamic = dynamic(
  () =>
    import("@/components/map/stargazer-map-dynamic").then((m) => ({
      default: m.StargazerMapDynamic,
    })),
  { ssr: false },
);

const TokenModal = dynamic(
  () => import("@/components/token-modal").then((m) => ({ default: m.TokenModal })),
  { ssr: false },
);

// StargazerMapDynamic accepts StargazerPoint[] (FollowerPoint is shape-compatible
// (starredAt and linkedinUrl are absent, but both optional/nullable in StargazerPoint).
// SAFETY: FollowerPoint is a structural subset of StargazerPoint; map only uses lat/lng/login.
const asMapPoints = (pts: FollowerPoint[]) =>
  pts as unknown as Parameters<typeof StargazerMapDynamic>[0]["points"];

export default function FollowersPageClient({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  const { owner } = use(params);
  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl =
    theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [scan, dispatch] = useReducer(followersScanReducer, {
    points: [],
    unmapped: [],
    processed: 0,
  });
  const { points, unmapped } = scan;

  const [total, setTotal] = useState(0);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [flyTarget, setFlyTarget] = useState<{
    lat: number;
    lng: number;
    login: string;
  } | null>(null);

  const ghHeaders = useCallback((): Record<string, string> => {
    const t = getStoredToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["x-gh-token"] = t;
    return h;
  }, []);

  const {
    status,
    retryIn,
    waitReason,
    error,
    handleStartScan,
    handleTokenClose,
  } = useFollowersScanController({
    login: owner,
    dispatch,
    setTotal,
    setTokenOpen,
    setHasToken,
    ghHeaders,
  });

  const mapPoints = useMemo(() => asMapPoints(points), [points]);
  const totalScanned = scan.processed;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Header />
      <main className="relative flex-1 overflow-hidden">
        {/* Map */}
        <StargazerMapDynamic
          points={mapPoints}
          comparePoints={[]}
          flyTarget={flyTarget}
          setFlyTarget={setFlyTarget}
          mapStyleUrl={mapStyleUrl}
          followerFilter="all"
          clusterRadius={50}
          viewMode="clusters"
          timelapseActive={false}
          timelapsePoints={null}
        />

        {/* Top bar */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 flex-wrap justify-center px-4">
          <div className="bg-surface/90 backdrop-blur-sm border border-border rounded-full px-4 py-2 flex items-center gap-2 text-sm">
            <a
              href={`/${owner}`}
              className="text-foreground font-medium hover:text-accent-blue transition-colors"
            >
              @{owner}
            </a>
            <span className="text-muted">followers</span>
            {total > 0 && (
              <span className="text-muted tabular-nums">
                · {totalScanned.toLocaleString()}/{total.toLocaleString()}
              </span>
            )}
          </div>

          {status === "idle" && (
            <button
              onClick={handleStartScan}
              className="bg-accent-green text-white font-semibold px-4 py-2 rounded-full text-sm hover:opacity-90 transition-opacity"
            >
              Map followers
            </button>
          )}

          {(status === "loading" || status === "waiting") && (
            <div className="bg-surface/90 backdrop-blur-sm border border-border rounded-full px-3 py-2 text-xs text-muted flex items-center gap-2">
              {status === "loading" ? (
                <>
                  <span className="inline-block size-2 rounded-full bg-accent-green animate-pulse" />
                  Scanning…
                </>
              ) : (
                <>
                  {waitReason === "github" ? "GitHub rate limit" : "Server busy"},
                  retry in {retryIn}s
                </>
              )}
            </div>
          )}

          {totalScanned > 0 && (
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="bg-surface/90 backdrop-blur-sm border border-border rounded-full px-3 py-2 flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
              aria-expanded={panelOpen}
              aria-label="Toggle followers list"
            >
              <Users size={12} aria-hidden="true" />
              {totalScanned.toLocaleString()}
            </button>
          )}

          {status === "error" && (
            <div className="bg-surface/90 backdrop-blur-sm border border-border rounded-full px-3 py-2 text-xs text-accent-red">
              Error: {error}
            </div>
          )}
        </div>

        {/* Followers panel */}
        <FollowersPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          points={points}
          unmapped={unmapped}
          setFlyTarget={setFlyTarget}
        />
      </main>
      <Footer />

      {tokenOpen && (
        <TokenModal open={tokenOpen} onClose={handleTokenClose} repoStars={total} />
      )}
    </div>
  );
}
```

- [ ] **Step 6.3: TypeScript check**

```bash
rtk tsc
```

Fix any type errors. Common ones to watch: `StargazerMapDynamic` props may require `timelapsePoints` to be a specific type : check the component's actual props signature and adjust the cast comment if needed.

- [ ] **Step 6.4: Commit**

```bash
git add src/app/[owner]/followers/
git commit -m "feat(ui): add /[owner]/followers page with map and side panel"
```

---

### Task 7: Add followers link on profile page

**Files:**
- Modify: `src/app/[owner]/page.client.tsx`

- [ ] **Step 7.1: Find the profile header in `page.client.tsx`**

```bash
grep -n "userInfo\." src/app/\[owner\]/page.client.tsx | head -20
```

Identify where `userInfo.login` or `userInfo.avatarUrl` is rendered in the JSX (this is the profile header section.

- [ ] **Step 7.2: Add the followers link**

Add `import { Users } from "lucide-react";` if not already imported.

In the profile header section, near the username display, insert:

```tsx
<Link
  href={`/${owner}/followers`}
  className="inline-flex items-center gap-1.5 text-xs text-muted border border-border-subtle rounded-full px-3 py-1.5 hover:text-foreground hover:border-border transition-colors min-h-[44px]"
>
  <Users size={12} aria-hidden="true" />
  Followers map
</Link>
```

- [ ] **Step 7.3: TypeScript check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 7.4: Commit**

```bash
git add src/app/\[owner\]/page.client.tsx
git commit -m "feat(ui): add followers map link on profile page"
```

---

### Task 8: Final verification

- [ ] **Step 8.1: Run full test suite**

```bash
rtk vitest run
```

Expected: All existing tests pass. New tests for `fetchFollowersPage` and `POST /api/followers-chunk` pass.

- [ ] **Step 8.2: TypeScript full check**

```bash
rtk tsc
```

Expected: 0 errors.

- [ ] **Step 8.3: Manual smoke test**

```bash
pnpm dev
```

1. Open `http://localhost:3000/torvalds/followers`
2. Click "Map followers" → verify scan starts and points appear progressively on map
3. Click the followers count pill (top bar) → verify `FollowersPanel` opens on the right
4. Search for a follower login in the panel search box → verify filtering works
5. Click "On map" filter → verify only geocoded followers are shown
6. Hover a mapped row, click the MapPin icon → verify map flies to that location
7. Click "No location" filter → verify only unmapped followers are shown
8. Open `http://localhost:3000/torvalds` → verify "Followers map" link appears in profile header
9. Click the link → verify redirect to `/torvalds/followers`
