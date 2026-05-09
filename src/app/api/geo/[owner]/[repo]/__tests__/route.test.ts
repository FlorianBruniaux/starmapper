// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() { return {}; }
    async limit() { return { success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }; }
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

const mockApiFindUnique = vi.fn();
const mockCacheFindUnique = vi.fn();
const mockBadgeFindUnique = vi.fn();
const mockApiUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findUnique: (...args: unknown[]) => mockApiFindUnique(...args),
      update: (...args: unknown[]) => mockApiUpdate(...args),
    },
    stargazerCache: { findUnique: (...args: unknown[]) => mockCacheFindUnique(...args) },
    badgeCache: { findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args) },
  },
}));

// Stable hash for the test API key "test-api-key-uuid"
const KNOWN_KEY = "test-api-key-uuid";
const KNOWN_HASH = "b3a78b43b76ce3e5adb8cc6b00f1fdbf6db50f70e8ba4a143437e44c665c3ef3";

vi.mock("@/lib/api-key", () => ({
  hashApiKey: (key: string) =>
    key === KNOWN_KEY ? KNOWN_HASH : `hash_of_${key}`,
}));

// gzip compressed stub — minimal valid gzip+base64 representing an empty JSON array
const EMPTY_GZ_B64 = require("zlib").gzipSync(Buffer.from("[]")).toString("base64");

import { GET } from "@/app/api/geo/[owner]/[repo]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  path: { owner: string; repo: string },
  opts: { authorization?: string } = {},
): [NextRequest, { params: Promise<{ owner: string; repo: string }> }] => {
  const headers: Record<string, string> = {};
  if (opts.authorization) headers["authorization"] = opts.authorization;
  const req = new NextRequest(`http://localhost/api/geo/${path.owner}/${path.repo}`, { headers });
  return [req, { params: Promise.resolve(path) }];
};

const validKey = { key: KNOWN_KEY, revokedAt: null };
const validCache = { points: EMPTY_GZ_B64, totalCount: 42, scannedAt: new Date() };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/geo/[owner]/[repo]", () => {
  beforeEach(() => {
    vi.resetAllMocks();  // clears queued mockResolvedValueOnce entries AND call history
    mockApiFindUnique.mockResolvedValue(null);
    mockCacheFindUnique.mockResolvedValue(null);
    mockBadgeFindUnique.mockResolvedValue(null);
    mockApiUpdate.mockResolvedValue(undefined);
  });

  // ── Path validation ────────────────────────────────────────────────────────

  describe("path validation", () => {
    it("returns 400 for an invalid owner (contains slash)", async () => {
      const [req, ctx] = makeReq({ owner: "bad/owner", repo: "repo" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
    });
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" });
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header does not start with 'Bearer '", async () => {
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: "Basic abc" });
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
    });

    it("returns 401 when key is not found by hash or plaintext", async () => {
      mockApiFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
    });

    it("returns 403 when the key is revoked", async () => {
      mockApiFindUnique.mockResolvedValueOnce({ key: KNOWN_KEY, revokedAt: new Date() });
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(403);
    });

    it("looks up by keyHash first (hash-based lookup)", async () => {
      // First call (by keyHash) returns the key; second call (plaintext fallback) never invoked
      mockApiFindUnique
        .mockResolvedValueOnce(validKey)   // keyHash lookup
        .mockResolvedValueOnce(null);       // plaintext fallback — should not be reached
      mockCacheFindUnique.mockResolvedValue(validCache);
      mockBadgeFindUnique.mockResolvedValue(null);

      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);

      // Verify the first lookup was by keyHash, not by key
      const firstCall = mockApiFindUnique.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(firstCall.where).toHaveProperty("keyHash", KNOWN_HASH);
      expect(firstCall.where).not.toHaveProperty("key");
    });

    it("falls back to plaintext key lookup when keyHash lookup returns null", async () => {
      mockApiFindUnique
        .mockResolvedValueOnce(null)      // keyHash lookup misses
        .mockResolvedValueOnce(validKey); // plaintext fallback hits
      mockCacheFindUnique.mockResolvedValue(validCache);
      mockBadgeFindUnique.mockResolvedValue(null);

      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);

      const secondCall = mockApiFindUnique.mock.calls[1][0] as { where: Record<string, unknown> };
      expect(secondCall.where).toHaveProperty("key", KNOWN_KEY);
    });
  });

  // ── Data retrieval ─────────────────────────────────────────────────────────

  describe("data retrieval", () => {
    beforeEach(() => {
      mockApiFindUnique.mockResolvedValue(validKey);
    });

    it("returns 404 when the repo has no scan cache", async () => {
      mockCacheFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 200 with metadata, countries, and cities for a valid cached scan", async () => {
      const points = [{ login: "a", lat: 48.85, lng: 2.35, location: "Paris, France" }];
      const gz = require("zlib").gzipSync(Buffer.from(JSON.stringify(points))).toString("base64");
      mockCacheFindUnique.mockResolvedValue({ points: gz, totalCount: 1, scannedAt: new Date("2024-01-01") });
      mockBadgeFindUnique.mockResolvedValue({ totalCount: 1, mappedCount: 1 });

      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.metadata.owner).toBe("octocat");
      expect(json.metadata.repo).toBe("hello");
      expect(Array.isArray(json.countries)).toBe(true);
      expect(Array.isArray(json.cities)).toBe(true);
    });

    it("returns 500 on DB error during key lookup", async () => {
      mockApiFindUnique.mockRejectedValue(new Error("DB timeout"));
      const [req, ctx] = makeReq({ owner: "octocat", repo: "hello" }, { authorization: `Bearer ${KNOWN_KEY}` });
      const res = await GET(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
