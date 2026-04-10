// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LANGUAGE_COLORS } from "@/lib/language-colors";
import { LANGUAGE_SLUG_MAP } from "@/lib/languages";

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

// ─── Tests for language-colors completeness ───────────────────────────────────

describe("language-colors coverage", () => {
  it("has a color for every canonical language in LANGUAGE_SLUG_MAP", () => {
    const canonicals = new Set(Object.values(LANGUAGE_SLUG_MAP));
    const missing: string[] = [];
    for (const lang of canonicals) {
      if (!(lang in LANGUAGE_COLORS)) missing.push(lang);
    }
    expect(missing, `Missing colors for: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ─── Tests for GET /api/devs/atlas ───────────────────────────────────────────

describe("GET /api/devs/atlas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dominant shape with countries array", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { country: "France", top_lang: "Python", top_cnt: 1200, total: 3500 },
      { country: "Germany", top_lang: "Java", top_cnt: 800, total: 2100 },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json() as Awaited<ReturnType<typeof res.json>>;

    expect(json.mode).toBe("dominant");
    expect(json.countries).toHaveLength(2);
    expect(json.countries[0]).toEqual({
      country: "France",
      topLang: "Python",
      topCnt: 1200,
      total: 3500,
    });
    expect(json.meta.minDevsThreshold).toBe(10);
  });

  it("returns empty countries array on Prisma error (graceful degradation)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(
      new Error("relation country_language_stats_mv does not exist"),
    );

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json() as Awaited<ReturnType<typeof res.json>>;

    expect(json.mode).toBe("dominant");
    expect(json.countries).toHaveLength(0);
  });

  it("maps DB row keys (snake_case) to response keys (camelCase)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { country: "Japan", top_lang: "TypeScript", top_cnt: 500, total: 1800 },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json() as Awaited<ReturnType<typeof res.json>>;

    const row = json.countries[0];
    expect(row.topLang).toBe("TypeScript");
    expect(row.topCnt).toBe(500);
    expect(row).not.toHaveProperty("top_lang");
    expect(row).not.toHaveProperty("top_cnt");
  });

  it("returns valid generatedAt ISO timestamp", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json() as Awaited<ReturnType<typeof res.json>>;

    expect(() => new Date(json.meta.generatedAt)).not.toThrow();
    expect(new Date(json.meta.generatedAt).getTime()).toBeGreaterThan(0);
  });
});
