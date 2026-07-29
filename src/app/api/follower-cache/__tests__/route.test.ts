// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    followerCache: { upsert: (...args: unknown[]) => mockUpsert(...args) },
  },
}));

const mockCheckDbHealth = vi.fn();
vi.mock("@/lib/db-health", () => ({
  checkDbHealth: (...args: unknown[]) => mockCheckDbHealth(...args),
  DB_CRITICAL_PCT: 95,
}));

const mockVerifyToken = vi.fn();
vi.mock("@/lib/api-token", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  getSmSecrets: () => {
    const s = process.env.SM_TOKEN_SECRET;
    return s ? [s] : [];
  },
  COOKIE_NAME: "sm-token",
}));

import { POST } from "@/app/api/follower-cache/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

const makeReq = (body: Body, opts: { cookie?: string } = {}): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  return new NextRequest("http://localhost/api/follower-cache", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
};

const validBody = (): Body => ({
  login: "octocat",
  pointsGz: "gz_points",
  unmappedGz: "gz_unmapped",
  totalCount: 100,
});

const healthOk = { ok: true as const, usagePct: 10 };

describe("POST /api/follower-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue(undefined);
    mockCheckDbHealth.mockResolvedValue(healthOk);
    mockVerifyToken.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("input validation", () => {
    it("returns 400 invalid_params for an invalid login", async () => {
      const res = await POST(makeReq({ ...validBody(), login: "bad login" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });
  });

  // This route used to return 403 forbidden outright whenever SM_TOKEN_SECRET was unset —
  // every sibling write route (stargazer-cache, badge-update, recalculate-location,
  // contributors-badge-update) instead skips the check in that case, matching the documented
  // local-dev fallback. These tests pin the corrected, consistent behavior.
  describe("SM_TOKEN_SECRET auth", () => {
    it("skips the token check and proceeds when SM_TOKEN_SECRET is not set", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "");
      const res = await POST(makeReq(validBody()));
      expect(res.status).toBe(200);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it("returns 403 forbidden when secret is set and token is invalid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq(validBody(), { cookie: "sm-token=bad" }));
      expect(res.status).toBe(403);
    });

    it("proceeds when secret is set and token is valid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(true);
      const res = await POST(makeReq(validBody(), { cookie: "sm-token=good" }));
      expect(res.status).toBe(200);
    });
  });

  describe("plausibility check", () => {
    it("skips plausibility when no known user", async () => {
      mockFindUnique.mockResolvedValue(null);
      const res = await POST(makeReq({ ...validBody(), totalCount: 99_999 }));
      expect(res.status).toBe(200);
    });

    it("returns 400 totalCount_mismatch when totalCount exceeds 5x known followers", async () => {
      mockFindUnique.mockResolvedValue({ followers: 100 });
      const res = await POST(makeReq({ ...validBody(), totalCount: 501 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "totalCount_mismatch" });
    });

    it("accepts totalCount within 5x known followers", async () => {
      mockFindUnique.mockResolvedValue({ followers: 100 });
      const res = await POST(makeReq({ ...validBody(), totalCount: 400 }));
      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });

  describe("DB storage guard", () => {
    it("returns 507 storage_full when usagePct >= DB_CRITICAL_PCT", async () => {
      mockCheckDbHealth.mockResolvedValue({ ok: true, usagePct: 96 });
      const res = await POST(makeReq(validBody()));
      expect(res.status).toBe(507);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});
