// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

import { GET } from "@/app/api/explore/locations/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}): NextRequest => {
  const url = new URL("http://localhost/api/explore/locations");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

const countryRows = [
  { label: "France", cnt: 5000n },
  { label: "Germany", cnt: 3000n },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/locations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue(countryRows);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with items, total, page, pageSize", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(typeof json.total).toBe("number");
      expect(typeof json.page).toBe("number");
      expect(typeof json.pageSize).toBe("number");
    });

    it("returns items as [label, count] tuples", async () => {
      const json = await (await GET(makeReq())).json();
      const item = json.items[0];
      expect(Array.isArray(item)).toBe(true);
      expect(typeof item[0]).toBe("string");
      expect(typeof item[1]).toBe("number");
    });

    it("converts bigint cnt to number in response", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.items[0][1]).toBe(5000);
    });

    it("uses CDN cache for country type (no country filter)", async () => {
      const res = await GET(makeReq({ type: "country" }));
      expect(res.headers.get("cache-control")).toContain("s-maxage=600");
    });

    it("uses no-store for city type with country filter", async () => {
      const res = await GET(makeReq({ type: "city", country: "France" }));
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws on fallback too", async () => {
      // The country MV query catches and retries; if fallback also throws, propagates
      mockQueryRaw.mockRejectedValue(new Error("both queries failed"));
      const res = await GET(makeReq({ type: "city" }));
      expect(res.status).toBe(500);
    });
  });
});
