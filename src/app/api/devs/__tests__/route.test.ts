// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock("@/lib/api-helpers", () => ({
  logError: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { prisma } from "@/lib/db";
import { GET } from "../route";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/devs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns whitelisted languages sorted desc by count", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { lang: "Python", cnt: 1000 },
      { lang: "TypeScript", cnt: 800 },
      { lang: "NotInWhitelist", cnt: 999 }, // should be filtered out
      { lang: "Go", cnt: 500 },
    ]);

    const res = await GET();
    const body = await res.json() as { languages: { slug: string; name: string; count: number }[] };

    expect(body.languages).toHaveLength(3);
    expect(body.languages[0]).toEqual({ slug: "python", name: "Python", count: 1000 });
    expect(body.languages[1]).toEqual({ slug: "typescript", name: "TypeScript", count: 800 });
    expect(body.languages[2]).toEqual({ slug: "go", name: "Go", count: 500 });
    // Non-whitelisted lang absent
    expect(body.languages.find((l) => l.name === "NotInWhitelist")).toBeUndefined();
  });

  it("filters out languages with count === 0", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { lang: "Rust", cnt: 50 },
      { lang: "Zig", cnt: 0 },
    ]);

    const res = await GET();
    const body = await res.json() as { languages: { name: string; count: number }[] };

    expect(body.languages).toHaveLength(1);
    expect(body.languages[0].name).toBe("Rust");
  });

  it("returns 200 with empty languages array when DB is down", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB connection failed"));

    const res = await GET();
    const body = await res.json() as { languages: unknown[] };

    expect(res.status).toBe(200);
    expect(body.languages).toEqual([]);
  });

  it("returns Cache-Control header", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("does not include Cache-Control on DB error", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("fail"));

    const res = await GET();
    // On error, no CDN caching (stale fallback would serve empty list forever)
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});
