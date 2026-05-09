// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBadgeFindUnique = vi.fn();
const mockBadgeUpsert = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: {
      findUnique: (...args: unknown[]) => mockBadgeFindUnique(...args),
      upsert: (...args: unknown[]) => mockBadgeUpsert(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const mockVerifyToken = vi.fn();

vi.mock("@/lib/api-token", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  COOKIE_NAME: "sm-token",
}));

vi.mock("@/lib/organic-score", () => ({
  computeOrganicScore: () => ({ score: 85, tier: "good" }),
}));

import { POST } from "@/app/api/badge-update/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type BadgeBody = {
  owner?: unknown;
  repo?: unknown;
  mappedCount?: unknown;
  countryCount?: unknown;
  totalCount?: unknown;
  language?: unknown;
  forksCount?: unknown;
  watchersCount?: unknown;
};

const makeReq = (body: BadgeBody, smToken?: string): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (smToken) headers["cookie"] = `sm-token=${smToken}`;
  return new NextRequest("http://localhost/api/badge-update", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const VALID_BODY: BadgeBody = {
  owner: "octocat",
  repo: "hello-world",
  mappedCount: 500,
  countryCount: 30,
  totalCount: 1000,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/badge-update", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.SM_TOKEN_SECRET;
    delete process.env.NEXT_PUBLIC_ORGANIC_SCORE_ENABLED;
    mockBadgeFindUnique.mockResolvedValue(null);
    mockBadgeUpsert.mockResolvedValue(undefined);
    mockVerifyToken.mockResolvedValue(true);
    mockQueryRaw.mockResolvedValue([{ zero_count: 10n, sample_size: 100n }]);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for invalid owner", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, owner: "bad owner!" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when mappedCount is negative", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, mappedCount: -1 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when totalCount is missing", async () => {
      const { totalCount: _, ...rest } = VALID_BODY;
      const res = await POST(makeReq(rest));
      expect(res.status).toBe(400);
    });

    it("returns 400 when totalCount exceeds 10,000,000", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, totalCount: 10_000_001 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when language is a number (not string or null)", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, language: 42 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when forksCount is a string", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, forksCount: "many" }));
      expect(res.status).toBe(400);
    });

    it("accepts optional language as null", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, language: null }));
      expect(res.status).toBe(200);
    });

    it("accepts optional forksCount and watchersCount", async () => {
      const res = await POST(makeReq({ ...VALID_BODY, forksCount: 10, watchersCount: 5 }));
      expect(res.status).toBe(200);
    });
  });

  // ── SM token guard ────────────────────────────────────────────────────────

  describe("SM token guard", () => {
    it("returns 403 when SM_TOKEN_SECRET is set and token is missing", async () => {
      process.env.SM_TOKEN_SECRET = "super-secret-32-chars-minimum!!!!";
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq(VALID_BODY)); // no cookie
      expect(res.status).toBe(403);
    });

    it("proceeds when SM_TOKEN_SECRET is set and token is valid", async () => {
      process.env.SM_TOKEN_SECRET = "super-secret-32-chars-minimum!!!!";
      mockVerifyToken.mockResolvedValue(true);
      const res = await POST(makeReq(VALID_BODY, "valid-token"));
      expect(res.status).toBe(200);
    });

    it("skips token check when SM_TOKEN_SECRET is not configured", async () => {
      // SM_TOKEN_SECRET deleted in beforeEach — no token, still succeeds
      const res = await POST(makeReq(VALID_BODY));
      expect(res.status).toBe(200);
    });
  });

  // ── Plausibility guard ────────────────────────────────────────────────────

  describe("plausibility guard", () => {
    it("returns 400 when new totalCount is >150% of existing", async () => {
      mockBadgeFindUnique.mockResolvedValue({ totalCount: 1000, owner: "octocat", repo: "hello-world" });
      const res = await POST(makeReq({ ...VALID_BODY, totalCount: 1501 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when new totalCount is <50% of existing", async () => {
      mockBadgeFindUnique.mockResolvedValue({ totalCount: 1000, owner: "octocat", repo: "hello-world" });
      const res = await POST(makeReq({ ...VALID_BODY, totalCount: 499 }));
      expect(res.status).toBe(400);
    });

    it("allows update when existing totalCount is 0 (no plausibility check)", async () => {
      mockBadgeFindUnique.mockResolvedValue({ totalCount: 0, owner: "octocat", repo: "hello-world" });
      const res = await POST(makeReq(VALID_BODY));
      expect(res.status).toBe(200);
    });

    it("allows update within ±50% band", async () => {
      mockBadgeFindUnique.mockResolvedValue({ totalCount: 1000, owner: "octocat", repo: "hello-world" });
      const res = await POST(makeReq({ ...VALID_BODY, totalCount: 1000 }));
      expect(res.status).toBe(200);
    });
  });

  // ── Successful upsert ─────────────────────────────────────────────────────

  describe("successful upsert", () => {
    it("returns 200 with ok:true", async () => {
      const res = await POST(makeReq(VALID_BODY));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("calls badgeCache.upsert with owner and repo from validated key", async () => {
      await POST(makeReq(VALID_BODY));
      expect(mockBadgeUpsert).toHaveBeenCalledOnce();
      const call = mockBadgeUpsert.mock.calls[0][0] as { where: Record<string, unknown>; create: Record<string, unknown> };
      expect(call.where).toHaveProperty("owner_repo");
    });

    it("does not compute organic score when flag is disabled", async () => {
      await POST(makeReq({ ...VALID_BODY, forksCount: 10, watchersCount: 5 }));
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws during upsert", async () => {
      mockBadgeUpsert.mockRejectedValue(new Error("constraint"));
      const res = await POST(makeReq(VALID_BODY));
      expect(res.status).toBe(500);
    });
  });
});
