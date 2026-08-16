// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockCacheFind = vi.fn();
const mockBadgeFind = vi.fn();
const mockCacheFullFind = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    stargazerCache: {
      findUnique: (...args: unknown[]) => {
        // The route calls findUnique twice: first for meta (scannedAt only),
        // then for full row. Delegate both to a single mock so each test can
        // sequence return values with mockResolvedValueOnce.
        return mockCacheFind(...args);
      },
    },
    badgeCache: { findUnique: (...args: unknown[]) => mockBadgeFind(...args) },
  },
}));

const POINTS = [{ login: "a", lat: 1, lng: 2 }];
const UNMAPPED = [{ login: "b" }];
// Full-precision coordinates, to prove the route still rounds them down to 2 decimals.
const PRECISE_POINTS = [{ login: "a", lat: 48.856614, lng: 2.3522219 }];

vi.mock("@/lib/compression", () => ({
  decompressGzBase64: (v: unknown) => {
    if (v === "gz_points") return POINTS;
    if (v === "gz_precise") return PRECISE_POINTS;
    if (v === "gz_unmapped") return UNMAPPED;
    return [];
  },
}));

import { GET } from "@/app/api/stargazer-cache/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  owner: string,
  repo: string,
  ifNoneMatch?: string,
  acceptEncoding?: string,
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => {
  const headers: Record<string, string> = {};
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  if (acceptEncoding) headers["accept-encoding"] = acceptEncoding;
  const req = new NextRequest(`http://localhost/api/stargazer-cache/${owner}/${repo}`, { headers });
  return [req, { params: Promise.resolve({ owner, repo }) }];
};

const SCANNED_AT = new Date("2024-06-01T00:00:00Z");
const ETAG = `"${SCANNED_AT.getTime()}"`;
const metaRow = { scannedAt: SCANNED_AT };
const fullRow = { scannedAt: SCANNED_AT, totalCount: 42, points: "gz_points", unmapped: "gz_unmapped", latestStarredAt: null };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/stargazer-cache/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCacheFind.mockResolvedValue(null);
    mockBadgeFind.mockResolvedValue(null);
    mockCacheFullFind.mockResolvedValue(null);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const [req, ctx] = makeReq("bad owner!", "repo");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── 404 / 206 branches ────────────────────────────────────────────────────

  describe("cache miss", () => {
    it("returns 404 when neither stargazer_cache nor badge_cache has data", async () => {
      mockCacheFind.mockResolvedValue(null);
      mockBadgeFind.mockResolvedValue(null);
      const [req, ctx] = makeReq("octocat", "hello");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 206 with lastScan when only badge_cache exists", async () => {
      mockCacheFind.mockResolvedValue(null);
      mockBadgeFind.mockResolvedValue({ updatedAt: SCANNED_AT });
      const [req, ctx] = makeReq("octocat", "hello");
      const res = await GET(req, ctx);
      expect(res.status).toBe(206);
      const json = await res.json();
      expect(json).toHaveProperty("lastScan", SCANNED_AT.toISOString());
    });
  });

  // ── ETag / 304 ────────────────────────────────────────────────────────────

  describe("ETag caching", () => {
    it("returns 304 when If-None-Match matches scannedAt ETag", async () => {
      mockCacheFind.mockResolvedValue(metaRow);
      const [req, ctx] = makeReq("octocat", "hello", ETAG);
      const res = await GET(req, ctx);
      expect(res.status).toBe(304);
    });

    it("returns 200 when If-None-Match does not match", async () => {
      // First call (meta) → metaRow, second call (full row) → fullRow
      mockCacheFind
        .mockResolvedValueOnce(metaRow)
        .mockResolvedValueOnce(fullRow);
      const [req, ctx] = makeReq("octocat", "hello", '"stale-etag"');
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
    });

    it("response includes ETag header matching scannedAt", async () => {
      mockCacheFind
        .mockResolvedValueOnce(metaRow)
        .mockResolvedValueOnce(fullRow);
      const [req, ctx] = makeReq("octocat", "hello");
      const res = await GET(req, ctx);
      expect(res.headers.get("etag")).toBe(ETAG);
    });
  });

  // ── 200 response shape ────────────────────────────────────────────────────

  describe("200 response", () => {
    beforeEach(() => {
      mockCacheFind
        .mockResolvedValueOnce(metaRow)
        .mockResolvedValueOnce(fullRow);
    });

    it("returns points, unmapped, totalCount, and scannedAt", async () => {
      const [req, ctx] = makeReq("octocat", "hello");
      const json = await (await GET(req, ctx)).json();
      expect(json.totalCount).toBe(42);
      expect(json.scannedAt).toBe(SCANNED_AT.toISOString());
      expect(Array.isArray(json.points)).toBe(true);
      expect(Array.isArray(json.unmapped)).toBe(true);
    });

    it("adds avatarUrl derived from login when missing from stored point", async () => {
      const [req, ctx] = makeReq("octocat", "hello");
      const json = await (await GET(req, ctx)).json();
      const point = json.points[0];
      expect(point.avatarUrl).toBe("https://github.com/a.png");
    });

    it("rounds lat/lng to 2 decimal places", async () => {
      const [req, ctx] = makeReq("octocat", "hello");
      const json = await (await GET(req, ctx)).json();
      const point = json.points[0];
      // lat=1, lng=2 are already integers — confirm they stay numeric
      expect(typeof point.lat).toBe("number");
      expect(typeof point.lng).toBe("number");
    });

    it("returns latestStarredAt as null when not set", async () => {
      const [req, ctx] = makeReq("octocat", "hello");
      const json = await (await GET(req, ctx)).json();
      expect(json.latestStarredAt).toBeNull();
    });
  });

  // ── Transport ──────────────────────────────────────────────────────────────

  // Fast Origin Transfer bills the function-to-edge segment, upstream of the CDN's own
  // client-facing compression, so this payload crossed it uncompressed. The envelope and
  // every field stay identical; only the encoding changes.
  describe("gzip transport", () => {
    beforeEach(() => {
      mockCacheFind
        .mockResolvedValueOnce(metaRow)
        .mockResolvedValueOnce(fullRow);
    });

    it("gzips the body when the client advertises gzip", async () => {
      const [req, ctx] = makeReq("octocat", "hello", undefined, "gzip, deflate, br");
      const res = await GET(req, ctx);
      expect(res.headers.get("content-encoding")).toBe("gzip");
      const raw = Buffer.from(await res.arrayBuffer());
      // gzip magic number, proving the body really is compressed
      expect(raw[0]).toBe(0x1f);
      expect(raw[1]).toBe(0x8b);
      const json = JSON.parse(gunzipSync(raw).toString("utf8"));
      expect(json.totalCount).toBe(42);
      expect(json.points).toHaveLength(1);
    });

    it("returns identity when the client does not advertise gzip", async () => {
      const [req, ctx] = makeReq("octocat", "hello", undefined, "identity");
      const res = await GET(req, ctx);
      expect(res.headers.get("content-encoding")).toBeNull();
      const json = await res.json();
      expect(json.totalCount).toBe(42);
    });

    it("always sets Vary: Accept-Encoding, both encodings share an s-maxage cache", async () => {
      for (const enc of ["gzip", "identity"]) {
        // Re-seed per iteration: the route consumes two findUnique calls each time.
        mockCacheFind.mockReset();
        mockCacheFind.mockResolvedValueOnce(metaRow).mockResolvedValueOnce(fullRow);
        const [req, ctx] = makeReq("octocat", "hello", undefined, enc);
        const res = await GET(req, ctx);
        expect(res.headers.get("vary")).toBe("Accept-Encoding");
      }
    });

    // Anti-regression guard. The stored blob is written client-side without validation,
    // so this rounding is the data-minimisation control, not an optimisation. Anyone
    // tempted to "simplify" by returning the blob verbatim has to break this test first.
    it("keeps lat/lng rounded to 2 decimals on the gzip path", async () => {
      // Drop the describe-level seeding, this test needs full-precision points instead.
      mockCacheFind.mockReset();
      mockCacheFind
        .mockResolvedValueOnce(metaRow)
        .mockResolvedValueOnce({ ...fullRow, points: "gz_precise" });
      const [req, ctx] = makeReq("octocat", "hello", undefined, "gzip");
      const res = await GET(req, ctx);
      const json = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
      expect(json.points[0].lat).toBe(48.86);
      expect(json.points[0].lng).toBe(2.35);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockCacheFind.mockRejectedValue(new Error("DB error"));
      const [req, ctx] = makeReq("octocat", "hello");
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
