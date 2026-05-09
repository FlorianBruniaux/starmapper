// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    gitHubUser: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { GET } from "@/app/api/explore/power/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}): NextRequest => {
  const url = new URL("http://localhost/api/explore/power");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/power", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: queryRaw called twice: groups + total count
    mockQueryRaw
      .mockResolvedValueOnce([{ login: "alice", cnt: 15n }])  // groups
      .mockResolvedValueOnce([{ total: 1000n }]);               // count
    mockFindMany.mockResolvedValue([{ login: "alice", name: "Alice", followers: 500 }]);
  });

  // ── Skip cap guard ────────────────────────────────────────────────────────

  describe("skip cap guard", () => {
    it("returns 400 when page exceeds skip cap (page 18 * size 30 = 510 > 500)", async () => {
      const res = await GET(makeReq({ page: "18", size: "30" }));
      expect(res.status).toBe(400);
    });

    it("allows page within cap (page 16 * size 30 = 450 ≤ 500)", async () => {
      mockQueryRaw
        .mockReset()
        .mockResolvedValueOnce([]) // groups
        .mockResolvedValueOnce([{ total: 0n }]); // count
      mockFindMany.mockResolvedValue([]);
      const res = await GET(makeReq({ page: "16", size: "30" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Cursor-based pagination ───────────────────────────────────────────────

  describe("cursor-based pagination", () => {
    it("returns 400 for malformed cursor (no pipe separator)", async () => {
      const res = await GET(makeReq({ cursor: "invalid-cursor" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for cursor with non-numeric count", async () => {
      const res = await GET(makeReq({ cursor: "notanumber|alice" }));
      expect(res.status).toBe(400);
    });

    it("accepts a valid cursor and returns 200", async () => {
      mockQueryRaw
        .mockReset()
        .mockResolvedValueOnce([{ login: "alice", cnt: 10n }]) // cursor-based groups
        .mockResolvedValueOnce([{ total: 500n }]);              // count
      const res = await GET(makeReq({ cursor: "15|alice" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with items, total, page, pageSize, nextCursor", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(typeof json.total).toBe("number");
      expect(typeof json.page).toBe("number");
      expect("nextCursor" in json).toBe(true);
    });

    it("derives avatarUrl from login", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.items[0]?.avatarUrl).toBe("https://github.com/alice.png");
    });

    it("includes trackedRepos count from MV", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.items[0]?.trackedRepos).toBe(15);
    });

    it("includes Cache-Control header", async () => {
      const res = await GET(makeReq());
      expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValue(new Error("MV not found"));
      const res = await GET(makeReq());
      expect(res.status).toBe(500);
    });
  });
});
