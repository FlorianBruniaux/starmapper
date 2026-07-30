// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUpsert = vi.fn();
const mockQueryRaw = vi.fn();
const mockCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    roadmapVote: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
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

import { POST, GET } from "@/app/api/roadmap-vote/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown, opts: { cookie?: string; ip?: string } = {}): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.ip) headers["x-real-ip"] = opts.ip;
  return new NextRequest("http://localhost/api/roadmap-vote", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
};

const healthOk = { ok: true as const, usagePct: 10 };
const emptyTallies = { tallies: { A: 0, B: 0, C: 0, D: 0 }, totalVoters: 0 };

describe("POST /api/roadmap-vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockUpsert.mockResolvedValue(undefined);
    mockQueryRaw.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockCheckDbHealth.mockResolvedValue(healthOk);
    mockVerifyToken.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("input validation", () => {
    it("returns 400 invalid_params for an empty options array", async () => {
      const res = await POST(makeReq({ options: [] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_params" });
    });

    it("returns 400 invalid_params for an invalid letter", async () => {
      const res = await POST(makeReq({ options: ["E"] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 invalid_params for duplicate options", async () => {
      const res = await POST(makeReq({ options: ["A", "A"] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(400);
    });

    it("accepts all four options at once", async () => {
      const res = await POST(makeReq({ options: ["A", "B", "C", "D"] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });

  describe("SM_TOKEN_SECRET auth", () => {
    it("skips the token check and proceeds when SM_TOKEN_SECRET is not set", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "");
      const res = await POST(makeReq({ options: ["A"] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(200);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it("returns 403 forbidden when secret is set and token is invalid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq({ options: ["A"] }, { cookie: "sm-token=bad", ip: "1.1.1.1" }));
      expect(res.status).toBe(403);
    });

    it("proceeds when secret is set and token is valid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "super-secret-32-chars-minimum!!");
      mockVerifyToken.mockResolvedValue(true);
      const res = await POST(makeReq({ options: ["A"] }, { cookie: "sm-token=good", ip: "1.1.1.1" }));
      expect(res.status).toBe(200);
    });
  });

  describe("DB storage guard", () => {
    it("returns 507 storage_full when usagePct >= DB_CRITICAL_PCT, upsert never called", async () => {
      mockCheckDbHealth.mockResolvedValue({ ok: true, usagePct: 96 });
      const res = await POST(makeReq({ options: ["A"] }, { ip: "1.1.1.1" }));
      expect(res.status).toBe(507);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe("dedupe by ip hash", () => {
    it("upserts twice with the same ipHash for the same IP, latest options win", async () => {
      await POST(makeReq({ options: ["A"] }, { ip: "2.2.2.2" }));
      await POST(makeReq({ options: ["B", "C"] }, { ip: "2.2.2.2" }));

      expect(mockUpsert).toHaveBeenCalledTimes(2);
      const firstCall = mockUpsert.mock.calls[0][0];
      const secondCall = mockUpsert.mock.calls[1][0];
      expect(secondCall.where.ipHash).toBe(firstCall.where.ipHash);
      expect(secondCall.update.options).toEqual(["B", "C"]);
    });

    it("does not crash when getIP falls back to 'unknown' (no IP headers)", async () => {
      const res = await POST(makeReq({ options: ["A"] }));
      expect(res.status).toBe(200);
    });
  });

  describe("response shape", () => {
    it("returns tallies reflecting the write", async () => {
      mockQueryRaw.mockResolvedValue([{ option: "A", count: 1n }]);
      mockCount.mockResolvedValue(1);
      const res = await POST(makeReq({ options: ["A"] }, { ip: "3.3.3.3" }));
      expect(await res.json()).toEqual({
        ok: true,
        tallies: { A: 1, B: 0, C: 0, D: 0 },
        totalVoters: 1,
      });
    });
  });
});

describe("GET /api/roadmap-vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockCheckDbHealth.mockResolvedValue(healthOk);
  });

  it("returns all-zero tallies for an empty table", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(emptyTallies);
  });

  it("returns tallies summing above totalVoters for overlapping multi-select votes", async () => {
    mockQueryRaw.mockResolvedValue([
      { option: "A", count: 2n },
      { option: "C", count: 2n },
    ]);
    mockCount.mockResolvedValue(2);
    const res = await GET();
    const body = await res.json();
    expect(body.totalVoters).toBe(2);
    const sum = Object.values(body.tallies as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBeGreaterThan(body.totalVoters);
  });

  it("returns 500 on a DB failure", async () => {
    mockQueryRaw.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("never calls checkDbHealth (guard applies to writes only)", async () => {
    await GET();
    expect(mockCheckDbHealth).not.toHaveBeenCalled();
  });
});
