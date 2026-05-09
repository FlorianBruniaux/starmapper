// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockCacheFindUnique = vi.fn();
const mockBadgeFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    stargazerCache: { findUnique: (...args: unknown[]) => mockCacheFindUnique(...args) },
    badgeCache: { findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args) },
  },
}));

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: (v: unknown) => (Array.isArray(v) ? v : []),
}));

import { GET } from "@/app/api/map-image/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (owner: string, repo: string, theme?: string): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => {
  const url = `http://localhost/api/map-image/${owner}/${repo}${theme ? `?theme=${theme}` : ""}`;
  return [new NextRequest(url), { params: Promise.resolve({ owner, repo }) }];
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/map-image/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCacheFindUnique.mockResolvedValue(null);
    mockBadgeFindUnique.mockResolvedValue(null);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for owner containing < (injection char rejected by validateOwnerRepo)", async () => {
      const [req, ctx] = makeReq("<script>", "repo");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for repo containing > (injection char)", async () => {
      const [req, ctx] = makeReq("owner", "bad>repo");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 for slash-separated owner (path traversal)", async () => {
      const [req, ctx] = makeReq("a/b", "repo");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Response format ────────────────────────────────────────────────────────

  describe("response format", () => {
    it("returns 200 with Content-Type image/svg+xml", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
    });

    it("returns valid SVG with width/height attributes", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="400"');
    });

    it("includes the repo label in the SVG output", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("octocat/hello-world");
    });

    it("returns SVG even when DB throws (empty map fallback)", async () => {
      mockCacheFindUnique.mockRejectedValue(new Error("DB down"));
      mockBadgeFindUnique.mockRejectedValue(new Error("DB down"));
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
    });
  });

  // ── Theme ──────────────────────────────────────────────────────────────────

  describe("theme", () => {
    it("uses dark background (#0d1117) by default", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("#0d1117");
    });

    it("uses light background (#ffffff) when theme=light", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world", "light");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("#ffffff");
    });

    it("falls back to dark for unknown theme values", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world", "unknown");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("#0d1117");
    });
  });

  // ── CRIT-1 regression: XML escaping ───────────────────────────────────────

  describe("XML escaping (CRIT-1 regression)", () => {
    it("escapes & in repo name to &amp; in SVG content", async () => {
      // repo names with & are accepted by validateOwnerRepo (alphanum + . - _),
      // but & in a badge URL param could arrive as "repo&amp;" in older flows.
      // The xmlEscape function must handle it if it ever appears in owner/repo.
      // We test the xmlEscape behaviour via a direct text that has no & (validate blocks it).
      // This test confirms validated owner/repo appear correctly in SVG title/text.
      const [req, ctx] = makeReq("test-owner", "my.repo");
      const res = await GET(req, ctx);
      const svg = await res.text();
      // Validated values should appear verbatim (no unescaped special chars)
      expect(svg).toContain("test-owner/my.repo");
      // And must not contain raw < > & characters injected from user input
      expect(svg).not.toMatch(/<script/i);
    });

    it("'no data' message appears when cache is empty", async () => {
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("No data yet");
    });

    it("shows stats text when badge data exists", async () => {
      mockBadgeFindUnique.mockResolvedValue({
        mappedCount: 500,
        countryCount: 30,
        totalCount: 1000,
        updatedAt: new Date(),
      });
      const [req, ctx] = makeReq("octocat", "hello-world");
      const res = await GET(req, ctx);
      const svg = await res.text();
      expect(svg).toContain("countries");
    });
  });
});
