// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Route uses prisma.$queryRaw twice in Promise.all:
//   call 1 → BadgeCacheRow[]  (the rows)
//   call 2 → [{ count: bigint }]  (the total)
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { GET } from "@/app/api/repos/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}, acceptEncoding?: string) => {
  const url = new URL("http://localhost/api/repos");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });
};

const makeRow = (owner: string, repo: string, overrides: Record<string, unknown> = {}) => ({
  owner,
  repo,
  mappedCount: 500,
  countryCount: 30,
  totalCount: 1000,
  language: "TypeScript",
  updatedAt: new Date("2026-01-01T12:00:00Z"),
  organicScore: null,
  organicTier: null,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/repos", () => {
  const defaultQueryRaw = () =>
    mockQueryRaw
      .mockResolvedValueOnce([makeRow("octocat", "hello-world")])
      .mockResolvedValueOnce([{ count: BigInt(1) }]);

  beforeEach(() => {
    vi.resetAllMocks();
    defaultQueryRaw();
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with repos array and total", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.repos)).toBe(true);
      expect(typeof json.total).toBe("number");
    });

    it("includes mappedPercent computed from mappedCount/totalCount", async () => {
      vi.resetAllMocks();
      mockQueryRaw
        .mockResolvedValueOnce([makeRow("octocat", "hello-world", { mappedCount: 500, totalCount: 1000 })])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].mappedPercent).toBe(50);
    });

    it("returns mappedPercent 0 when totalCount is 0 (avoids divide-by-zero)", async () => {
      vi.resetAllMocks();
      mockQueryRaw
        .mockResolvedValueOnce([makeRow("octocat", "hello-world", { mappedCount: 0, totalCount: 0 })])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].mappedPercent).toBe(0);
    });

    it("serializes updatedAt as ISO string", async () => {
      const json = await (await GET(makeReq())).json();
      expect(typeof json.repos[0].updatedAt).toBe("string");
      expect(json.repos[0].updatedAt).toContain("T");
    });

    it("includes null for organicScore when not set", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.repos[0].organicScore).toBeNull();
    });

    it("returns empty repos array when DB has no entries", async () => {
      vi.resetAllMocks();
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);
      const json = await (await GET(makeReq())).json();
      expect(json.repos).toHaveLength(0);
      expect(json.total).toBe(0);
    });

    it("includes Cache-Control header for CDN caching", async () => {
      const res = await GET(makeReq());
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Limit handling ─────────────────────────────────────────────────────────

  // fetchReposData carries "use cache", so its `limit` argument is part of the cache
  // key. The route snaps it onto a five-rung ladder and slices afterwards, which caps
  // the number of distinct cache entries without changing any caller's payload.
  // The pool actually sent to Postgres is the second tagged-template argument of the
  // first $queryRaw call (repos-query.ts `LIMIT ${pool}`).
  describe("limit handling", () => {
    const seedRows = (n: number) => {
      vi.resetAllMocks();
      mockQueryRaw
        .mockResolvedValueOnce(
          Array.from({ length: n }, (_, i) => makeRow(`owner${i}`, `repo${i}`)),
        )
        .mockResolvedValueOnce([{ count: BigInt(n) }]);
    };

    const poolArg = () => mockQueryRaw.mock.calls[0]?.[1];

    it("snaps limit=1 to the first ladder rung but returns exactly 1 row", async () => {
      seedRows(12);
      const json = await (await GET(makeReq({ limit: "1" }))).json();
      expect(poolArg()).toBe(12);
      expect(json.repos).toHaveLength(1);
    });

    it("snaps an off-ladder limit up to the next rung and slices back down", async () => {
      seedRows(50);
      const json = await (await GET(makeReq({ limit: "37" }))).json();
      expect(poolArg()).toBe(50);
      expect(json.repos).toHaveLength(37);
    });

    it("caps a limit above the ladder max at 5000", async () => {
      seedRows(3);
      await GET(makeReq({ limit: "99999" }));
      expect(poolArg()).toBe(5000);
    });

    it("falls back to 500 on a non-numeric limit instead of forwarding NaN", async () => {
      seedRows(3);
      await GET(makeReq({ limit: "abc" }));
      expect(poolArg()).toBe(500);
      expect(Number.isNaN(poolArg())).toBe(false);
    });

    it("clamps a zero or negative limit to 1", async () => {
      seedRows(12);
      const json = await (await GET(makeReq({ limit: "-5" }))).json();
      expect(poolArg()).toBe(12);
      expect(json.repos).toHaveLength(1);
    });

    it("defaults to 500 when no limit is given", async () => {
      seedRows(3);
      await GET(makeReq());
      expect(poolArg()).toBe(500);
    });

    it("keeps the diverse path equivalent: quantised pool, exact slice", async () => {
      seedRows(200);
      const json = await (await GET(makeReq({ limit: "6", diverse: "true" }))).json();
      // quantiseLimit(6) = 12, then repos-query widens it: min(12 * 40, 500) = 480
      expect(poolArg()).toBe(480);
      expect(json.repos).toHaveLength(6);
    });
  });

  // ── Transport ──────────────────────────────────────────────────────────────

  describe("gzip transport", () => {
    it("gzips the body when the client advertises gzip", async () => {
      const res = await GET(makeReq({}, "gzip, deflate, br"));
      expect(res.headers.get("content-encoding")).toBe("gzip");
      const raw = Buffer.from(await res.arrayBuffer());
      expect(raw[0]).toBe(0x1f);
      expect(raw[1]).toBe(0x8b);
      const json = JSON.parse(gunzipSync(raw).toString("utf8"));
      expect(json.repos).toHaveLength(1);
      expect(json.total).toBe(1);
    });

    it("returns identity when the client does not advertise gzip", async () => {
      const res = await GET(makeReq({}, "identity"));
      expect(res.headers.get("content-encoding")).toBeNull();
      expect((await res.json()).total).toBe(1);
    });

    // Mandatory: this route carries s-maxage=300, so without Vary the CDN could hand a
    // cached gzip body to an identity client.
    it("sets Vary: Accept-Encoding alongside the s-maxage cache header", async () => {
      const res = await GET(makeReq({}, "gzip"));
      expect(res.headers.get("vary")).toBe("Accept-Encoding");
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      vi.resetAllMocks();
      mockQueryRaw.mockRejectedValue(new Error("connection refused"));
      const res = await GET(makeReq());
      expect(res.status).toBe(500);
    });
  });
});
