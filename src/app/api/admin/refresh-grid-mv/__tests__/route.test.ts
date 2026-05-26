// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockPoolEnd = vi.fn();
const mockSafeEqual = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

// Pool now comes from pg (TCP mode). clearAllMocks resets the implementation, so
// setupPoolMock() re-applies it in each beforeEach with a regular function (arrow
// functions are not constructible with `new`).
vi.mock("pg", () => ({
  Pool: vi.fn(),
}));

vi.mock("@/lib/api-token", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

import { Pool as PgPool } from "pg";
import { POST, GET } from "@/app/api/admin/refresh-grid-mv/route";

const setupPoolMock = () => {
  vi.mocked(PgPool).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue({
        query: (...args: unknown[]) => mockQuery(...args),
        release: mockRelease,
      }),
      end: mockPoolEnd,
    };
  } as never);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makePost = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/refresh-grid-mv", { method: "POST" });

const makeGet = (authHeader?: string): NextRequest =>
  new NextRequest("http://localhost/api/admin/refresh-grid-mv", {
    headers: authHeader ? { authorization: authHeader } : {},
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/refresh-grid-mv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    setupPoolMock();
    mockRequireAdminAuth.mockReturnValue(null);
    mockQuery.mockResolvedValue({});
    mockRelease.mockReturnValue(undefined);
    mockPoolEnd.mockResolvedValue(undefined);
    mockSafeEqual.mockReturnValue(true);
  });

  it("returns 404 when admin auth fails", async () => {
    mockRequireAdminAuth.mockReturnValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const res = await POST(makePost());
    expect(res.status).toBe(404);
  });

  it("returns { ok: true } when refresh succeeds", async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.durationMs).toBe("number");
  });

  it("returns 200 with partial errors when one MV query throws", async () => {
    mockQuery
      .mockResolvedValueOnce({}) // SET statement_timeout = 0
      .mockRejectedValueOnce(new Error("MV locked")); // first REFRESH fails
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.results.some((r: { error?: string }) => r.error !== undefined)).toBe(true);
  });
});

describe("GET /api/admin/refresh-grid-mv (cron)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    setupPoolMock();
    mockQuery.mockResolvedValue({});
    mockRelease.mockReturnValue(undefined);
    mockPoolEnd.mockResolvedValue(undefined);
    mockSafeEqual.mockReturnValue(false);
  });

  it("returns 404 when CRON_SECRET is not set", async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
  });

  it("returns 404 when secret does not match", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    mockSafeEqual.mockReturnValue(false);
    const res = await GET(makeGet("Bearer wrong-secret"));
    expect(res.status).toBe(404);
  });

  it("runs refresh when CRON_SECRET matches", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    mockSafeEqual.mockReturnValue(true);
    const res = await GET(makeGet("Bearer correct-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
