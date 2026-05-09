// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockVerifyPat = vi.fn();
const mockNormalizeLogin = vi.fn((s: string) => s.toLowerCase() as string);
const mockGetRedis = vi.fn();

vi.mock("@/lib/github-auth", () => ({
  verifyPat: (...args: unknown[]) => mockVerifyPat(...args),
  normalizeLogin: (s: string) => mockNormalizeLogin(s),
  getRedis: () => mockGetRedis(),
}));

const mockNewsCreate = vi.fn();
const mockNewsFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    news: {
      findFirst: (...args: unknown[]) => mockNewsFindFirst(...args),
      create: (...args: unknown[]) => mockNewsCreate(...args),
    },
  },
}));

const mockGetOrCreate = vi.fn();

vi.mock("@/lib/user-cache", () => ({
  getOrCreateGitHubUserMinimal: (...args: unknown[]) => mockGetOrCreate(...args),
}));

import { POST } from "@/app/api/news/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown, pat?: string): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (pat !== undefined) headers["x-gh-token"] = pat;
  return new NextRequest("http://localhost/api/news", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const AUTHOR = "octocat";
const VALID_BODY = { body: "Hello world from StarMapper!" };

const makeNewsRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  authorLogin: AUTHOR,
  body: VALID_BODY.body,
  url: null,
  publishedAt: new Date("2026-01-01T12:00:00Z"),
  deletedAt: null,
  ...overrides,
});

// Redis mock factory
const mockRedis = (setResult: unknown = "OK") => ({
  set: vi.fn().mockResolvedValue(setResult),
  del: vi.fn().mockResolvedValue(1),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/news", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockVerifyPat.mockResolvedValue(AUTHOR);
    mockGetRedis.mockReturnValue(null); // no Redis by default
    mockNewsFindFirst.mockResolvedValue(null); // no cooldown by default
    mockNewsCreate.mockResolvedValue(makeNewsRow());
    mockGetOrCreate.mockResolvedValue(undefined);
  });

  // ── PAT authentication ────────────────────────────────────────────────────

  describe("PAT authentication", () => {
    it("returns 401 when x-gh-token header is absent", async () => {
      const req = makeReq(VALID_BODY);
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("pat_required");
    });

    it("returns 401 when PAT is invalid (verifyPat returns null)", async () => {
      mockVerifyPat.mockResolvedValue(null);
      const req = makeReq(VALID_BODY, "ghp_invalid");
      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("pat_invalid");
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost/api/news", {
        method: "POST",
        headers: { "x-gh-token": "ghp_valid", "content-type": "application/json" },
        body: "not-json{",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_json");
    });

    it("returns 400 when body text is missing", async () => {
      const req = makeReq({ url: "https://example.com" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("body_required");
    });

    it("returns 400 when body text is an empty string", async () => {
      const req = makeReq({ body: "   " }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("body_required");
    });

    it("returns 400 when body text exceeds 280 chars", async () => {
      const req = makeReq({ body: "a".repeat(281) }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("body_too_long");
    });

    it("accepts body text of exactly 280 chars", async () => {
      mockNewsCreate.mockResolvedValue(makeNewsRow({ body: "a".repeat(280) }));
      const req = makeReq({ body: "a".repeat(280) }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("returns 400 for url that does not start with https://", async () => {
      const req = makeReq({ body: "hi", url: "http://example.com" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("url_invalid");
    });

    it("returns 400 for url pointing to a private/loopback host (SSRF guard)", async () => {
      const req = makeReq({ body: "hi", url: "https://localhost/admin" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("url_invalid");
    });

    it("returns 400 for url pointing to 192.168.x.x (private IP range)", async () => {
      const req = makeReq({ body: "hi", url: "https://192.168.1.1/secret" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("url_invalid");
    });

    it("returns 400 for url pointing to 127.x.x.x", async () => {
      const req = makeReq({ body: "hi", url: "https://127.0.0.1/" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("url_invalid");
    });

    it("accepts a valid https:// public url", async () => {
      mockNewsCreate.mockResolvedValue(makeNewsRow({ url: "https://github.com/octocat" }));
      const req = makeReq({ body: "check this out", url: "https://github.com/octocat" }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("accepts null url (optional field)", async () => {
      const req = makeReq({ body: "hello", url: null }, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── Redis lock ────────────────────────────────────────────────────────────

  describe("Redis lock", () => {
    it("returns 429 when Redis lock cannot be acquired (set returns null)", async () => {
      const redis = mockRedis(null); // null = lock already held
      mockGetRedis.mockReturnValue(redis);
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe("cooldown_active");
    });

    it("proceeds when Redis lock is acquired (set returns 'OK')", async () => {
      const redis = mockRedis("OK");
      mockGetRedis.mockReturnValue(redis);
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("releases the Redis lock after success (calls del)", async () => {
      const redis = mockRedis("OK");
      mockGetRedis.mockReturnValue(redis);
      const req = makeReq(VALID_BODY, "ghp_valid");
      await POST(req);
      // del is called fire-and-forget in finally — wait a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(redis.del).toHaveBeenCalledWith(`lock:news:${AUTHOR}`);
    });

    it("proceeds without lock when Redis is unavailable (getRedis returns null)", async () => {
      mockGetRedis.mockReturnValue(null);
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── 24h cooldown ──────────────────────────────────────────────────────────

  describe("24h cooldown", () => {
    it("returns 429 with retryAfterSec when author posted within last 24h", async () => {
      const publishedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      mockNewsFindFirst.mockResolvedValue({ publishedAt });
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe("cooldown_active");
      // retryAfterSec ≈ 23h = 82800s (allow generous ±60s for timing)
      expect(json.retryAfterSec).toBeGreaterThan(82700);
      expect(json.retryAfterSec).toBeLessThan(82861);
    });

    it("allows posting when no recent post exists (findFirst returns null)", async () => {
      mockNewsFindFirst.mockResolvedValue(null);
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── Successful post ───────────────────────────────────────────────────────

  describe("successful post", () => {
    it("returns 200 with ok:true and a NewsItem", async () => {
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.news).toMatchObject({
        id: 1,
        authorLogin: AUTHOR,
        body: VALID_BODY.body,
      });
      expect(typeof json.news.publishedAt).toBe("string");
    });

    it("stores the trimmed body text (not raw with leading/trailing spaces)", async () => {
      const row = makeNewsRow({ body: "trimmed" });
      mockNewsCreate.mockResolvedValue(row);
      const req = makeReq({ body: "  trimmed  " }, "ghp_valid");
      await POST(req);
      const callArgs = mockNewsCreate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.body).toBe("trimmed");
    });

    it("stores url as null when not provided", async () => {
      const req = makeReq({ body: "hello" }, "ghp_valid");
      await POST(req);
      const callArgs = mockNewsCreate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.url).toBeNull();
    });

    it("stores authorLogin from verifyPat result (not raw header value)", async () => {
      mockVerifyPat.mockResolvedValue("OctoCat");
      const req = makeReq(VALID_BODY, "ghp_valid");
      await POST(req);
      const callArgs = mockNewsCreate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data.authorLogin).toBe("OctoCat");
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws during findFirst", async () => {
      mockNewsFindFirst.mockRejectedValue(new Error("DB timeout"));
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("internal");
    });

    it("returns 500 when DB throws during create", async () => {
      mockNewsCreate.mockRejectedValue(new Error("constraint violation"));
      const req = makeReq(VALID_BODY, "ghp_valid");
      const res = await POST(req);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("internal");
    });
  });
});
