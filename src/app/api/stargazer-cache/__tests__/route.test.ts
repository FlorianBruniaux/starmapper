// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    badgeCache: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    stargazerCache: { upsert: (...args: unknown[]) => mockUpsert(...args) },
  },
}));

vi.mock("@/lib/compression", () => ({
  compressToGzBase64: () => "gz_compressed_stub",
}));

const mockCheckDbHealth = vi.fn();
vi.mock("@/lib/db-health", () => ({
  checkDbHealth: (...args: unknown[]) => mockCheckDbHealth(...args),
  DB_CRITICAL_PCT: 95,
}));

const mockVerifyToken = vi.fn();
vi.mock("@/lib/api-token", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  COOKIE_NAME: "sm-token",
}));

import { POST } from "@/app/api/stargazer-cache/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

const makeReq = (body: Body, opts: { cookie?: string } = {}): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  return new NextRequest("http://localhost/api/stargazer-cache", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
};

const validBodyGz = (): Body => ({
  owner: "octocat",
  repo: "hello-world",
  pointsGz: "gz_data",
  unmappedGz: "gz_data",
  totalCount: 100,
  ts: Date.now(),
});

const healthOk = { ok: true as const, usagePct: 10 };
const healthFull = { ok: true as const, usagePct: 96 };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/stargazer-cache", () => {
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

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 invalid_params for invalid owner (contains slash)", async () => {
      const body = { ...validBodyGz(), owner: "bad/owner" };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });

    it("returns 400 invalid_params when totalCount is missing", async () => {
      const { totalCount: _, ...body } = validBodyGz();
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });

    it("returns 400 invalid_params when totalCount is negative", async () => {
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: -1 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });

    it("returns 400 invalid_params when totalCount exceeds 500_000", async () => {
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 500_001 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });
  });

  // ── Freshness (anti-replay) ────────────────────────────────────────────────

  describe("freshness check", () => {
    it("returns 400 expired_request when ts is missing", async () => {
      const { ts: _, ...body } = validBodyGz();
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "expired_request" });
    });

    it("returns 400 expired_request when ts is older than 5 minutes", async () => {
      const body = { ...validBodyGz(), ts: Date.now() - 6 * 60_000 };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "expired_request" });
    });

    it("returns 400 expired_request when ts is a string", async () => {
      const body = { ...validBodyGz(), ts: String(Date.now()) };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "expired_request" });
    });

    it("accepts ts within the 5-minute window", async () => {
      const body = { ...validBodyGz(), ts: Date.now() - 4 * 60_000 };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(200);
    });
  });

  // ── Session token auth ─────────────────────────────────────────────────────

  describe("SM_TOKEN_SECRET auth", () => {
    it("skips token check when SM_TOKEN_SECRET is not set", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "");
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(200);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it("returns 403 forbidden when secret is set and cookie is absent", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
    });

    it("returns 403 forbidden when secret is set and token is invalid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq(validBodyGz(), { cookie: "sm-token=bad_token" }));
      expect(res.status).toBe(403);
    });

    it("proceeds when secret is set and token is valid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(true);
      const res = await POST(makeReq(validBodyGz(), { cookie: "sm-token=valid_token" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Plausibility check ─────────────────────────────────────────────────────

  describe("plausibility check", () => {
    it("skips plausibility when no existing badge", async () => {
      mockFindUnique.mockResolvedValue(null);
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 9999 }));
      expect(res.status).toBe(200);
    });

    it("skips plausibility when existing badge totalCount is 0", async () => {
      mockFindUnique.mockResolvedValue({ totalCount: 0 });
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 50_000 }));
      expect(res.status).toBe(200);
    });

    it("returns 400 totalCount_mismatch when ratio is below 0.8", async () => {
      mockFindUnique.mockResolvedValue({ totalCount: 1000 });
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 799 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "totalCount_mismatch" });
    });

    it("returns 400 totalCount_mismatch when ratio exceeds 1.2", async () => {
      mockFindUnique.mockResolvedValue({ totalCount: 1000 });
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 1201 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "totalCount_mismatch" });
    });

    it("accepts totalCount within ±20% of existing badge", async () => {
      mockFindUnique.mockResolvedValue({ totalCount: 1000 });
      const res = await POST(makeReq({ ...validBodyGz(), totalCount: 1100 }));
      expect(res.status).toBe(200);
    });
  });

  // ── Payload format ─────────────────────────────────────────────────────────

  describe("payload format", () => {
    it("accepts pre-compressed format (pointsGz + unmappedGz strings)", async () => {
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockUpsert).toHaveBeenCalledOnce();
    });

    it("returns 413 payload_too_large when pointsGz exceeds 30 MB", async () => {
      const body = { ...validBodyGz(), pointsGz: "x".repeat(30_000_001) };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: "payload_too_large" });
    });

    it("returns 413 payload_too_large when unmappedGz exceeds 30 MB", async () => {
      const body = { ...validBodyGz(), unmappedGz: "x".repeat(30_000_001) };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: "payload_too_large" });
    });

    it("accepts legacy format (raw arrays) and calls compressToGzBase64", async () => {
      const body = {
        owner: "octocat",
        repo: "hello-world",
        points: [{ login: "a", lat: 1, lng: 2 }],
        unmapped: [{ login: "b" }],
        totalCount: 2,
        ts: Date.now(),
      };
      const res = await POST(makeReq(body));
      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });

    it("returns 400 invalid_params when both formats are absent", async () => {
      const { pointsGz: _, unmappedGz: __, ...body } = validBodyGz();
      const res = await POST(makeReq(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });
  });

  // ── DB storage guard ───────────────────────────────────────────────────────

  describe("DB storage guard", () => {
    it("returns 507 storage_full when health.ok=true and usagePct >= DB_CRITICAL_PCT", async () => {
      mockCheckDbHealth.mockResolvedValue(healthFull);
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(507);
      expect(await res.json()).toMatchObject({ error: "storage_full" });
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("still attempts upsert when health.ok=false (DB unreachable)", async () => {
      mockCheckDbHealth.mockResolvedValue({ ok: false });
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });

    it("proceeds when usagePct is below critical threshold", async () => {
      mockCheckDbHealth.mockResolvedValue({ ok: true, usagePct: 94 });
      const res = await POST(makeReq(validBodyGz()));
      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });

  // ── Upsert payload ─────────────────────────────────────────────────────────

  describe("upsert payload", () => {
    it("passes pointsGz and unmappedGz directly to upsert", async () => {
      const body = { ...validBodyGz(), pointsGz: "my_gz_points", unmappedGz: "my_gz_unmapped" };
      await POST(makeReq(body));
      const call = mockUpsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(call.create.points).toBe("my_gz_points");
      expect(call.create.unmapped).toBe("my_gz_unmapped");
    });

    it("stores latestStarredAt as a Date when provided", async () => {
      const body = { ...validBodyGz(), latestStarredAt: "2024-06-01T00:00:00Z" };
      await POST(makeReq(body));
      const call = mockUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(call.create.latestStarredAt).toBeInstanceOf(Date);
    });

    it("stores latestStarredAt as null when not provided", async () => {
      await POST(makeReq(validBodyGz()));
      const call = mockUpsert.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(call.create.latestStarredAt).toBeNull();
    });
  });
});
