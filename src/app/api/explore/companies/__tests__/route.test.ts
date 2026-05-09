// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

import { GET } from "@/app/api/explore/companies/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (params: Record<string, string> = {}): NextRequest => {
  const url = new URL("http://localhost/api/explore/companies");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/explore/companies", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([
      { company: "Google", cnt: 2000n },
      { company: "@github", cnt: 1500n },
      { company: "freelance", cnt: 500n }, // noise — should be filtered
      { company: "A", cnt: 100n }, // too short — should be filtered
    ]);
  });

  // ── Company normalization ─────────────────────────────────────────────────

  describe("company normalization", () => {
    it("strips leading @ from company names", async () => {
      const json = await (await GET(makeReq())).json();
      const companies = json.items.map(([name]: [string]) => name);
      expect(companies).not.toContain("@github");
      expect(companies).toContain("Github");
    });

    it("filters out known noise company names (freelance, student, etc.)", async () => {
      const json = await (await GET(makeReq())).json();
      const companies = json.items.map(([name]: [string]) => name);
      expect(companies).not.toContain("freelance");
      expect(companies).not.toContain("Freelance");
    });

    it("filters out single-character company names", async () => {
      const json = await (await GET(makeReq())).json();
      const companies = json.items.map(([name]: [string]) => name);
      expect(companies.every((c: string) => c.length >= 2)).toBe(true);
    });

    it("title-cases company names", async () => {
      const json = await (await GET(makeReq())).json();
      expect(json.items[0][0]).toBe("Google");
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with items, total, page, pageSize", async () => {
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      expect(typeof json.total).toBe("number");
    });

    it("uses CDN cache for global request", async () => {
      const res = await GET(makeReq());
      expect(res.headers.get("cache-control")).toContain("s-maxage=600");
    });

    it("uses no-store for country-filtered request", async () => {
      const res = await GET(makeReq({ country: "France" }));
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws on country-filtered request (no catch fallback)", async () => {
      mockQueryRaw.mockRejectedValue(new Error("constraint"));
      const res = await GET(makeReq({ country: "France" }));
      expect(res.status).toBe(500);
    });
  });
});
