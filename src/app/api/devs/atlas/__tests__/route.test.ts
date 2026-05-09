// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

vi.mock("@/lib/api-helpers", () => ({
  logError: vi.fn(),
}));

import { GET } from "@/app/api/devs/atlas/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const atlasRow = { country: "France", top_lang: "TypeScript", top_cnt: 2000, total: 5000 };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/devs/atlas", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockQueryRaw.mockResolvedValue([atlasRow]);
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with mode=dominant", async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.mode).toBe("dominant");
    });

    it("returns countries array with topLang, topCnt, total", async () => {
      const json = await (await GET()).json();
      expect(Array.isArray(json.countries)).toBe(true);
      const country = json.countries[0];
      expect(country.country).toBe("France");
      expect(country.topLang).toBe("TypeScript");
      expect(country.topCnt).toBe(2000);
      expect(country.total).toBe(5000);
    });

    it("includes meta with minDevsThreshold and generatedAt", async () => {
      const json = await (await GET()).json();
      expect(typeof json.meta.minDevsThreshold).toBe("number");
      expect(typeof json.meta.generatedAt).toBe("string");
    });

    it("returns Cache-Control s-maxage=3600", async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 200 with empty countries when DB throws (graceful degradation)", async () => {
      mockQueryRaw.mockRejectedValue(new Error("MV missing 42P01"));
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.countries).toEqual([]);
      expect(json.mode).toBe("dominant");
    });
  });
});
