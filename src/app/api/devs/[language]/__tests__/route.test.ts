// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

// slugToLanguage maps e.g. "typescript" → "TypeScript"
vi.mock("@/lib/languages", () => ({
  slugToLanguage: (slug: string) => {
    const map: Record<string, string> = { typescript: "TypeScript", python: "Python" };
    return map[slug] ?? null;
  },
}));

import { GET } from "@/app/api/devs/[language]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  language: string,
): [NextRequest, { params: Promise<{ language: string }> }] => [
  new NextRequest(`http://localhost/api/devs/${language}`),
  { params: Promise.resolve({ language }) },
];

const gridRow = { lat: 48.8, lng: 2.3, count: 150, topLogin: "torvalds" };
const countryRow = { country: "France", count: 1200 };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/devs/[language]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // First call: grid query; second: country query
    mockQueryRaw
      .mockResolvedValueOnce([gridRow])   // grid MV
      .mockResolvedValueOnce([countryRow]); // country query
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 404 for an unknown language slug", async () => {
      const [req, ctx] = makeReq("cobol");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 200 for a known language slug", async () => {
      const [req, ctx] = makeReq("typescript");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns language, cells, totalMapped, topCountries", async () => {
      const [req, ctx] = makeReq("typescript");
      const json = await (await GET(req, ctx)).json();
      expect(json.language).toBe("TypeScript");
      expect(Array.isArray(json.cells)).toBe(true);
      expect(typeof json.totalMapped).toBe("number");
      expect(Array.isArray(json.topCountries)).toBe(true);
    });

    it("includes lat/lng/count/topLogin per cell", async () => {
      const [req, ctx] = makeReq("typescript");
      const json = await (await GET(req, ctx)).json();
      const cell = json.cells[0];
      expect(cell.lat).toBe(48.8);
      expect(cell.count).toBe(150);
      expect(cell.topLogin).toBe("torvalds");
    });

    it("computes totalMapped as sum of cell counts", async () => {
      const [req, ctx] = makeReq("typescript");
      const json = await (await GET(req, ctx)).json();
      expect(json.totalMapped).toBe(150);
    });

    it("includes Cache-Control header", async () => {
      const [req, ctx] = makeReq("typescript");
      const res = await GET(req, ctx);
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws (both MV and fallback)", async () => {
      mockQueryRaw.mockReset();
      mockQueryRaw.mockRejectedValue(new Error("connection timeout"));
      const [req, ctx] = makeReq("typescript");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
