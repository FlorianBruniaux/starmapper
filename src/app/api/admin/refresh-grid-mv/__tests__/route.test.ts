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

// Use clearAllMocks (not resetAllMocks) so Pool factory implementation survives between tests.
// Pool is re-built per test via the factory; connect/query/release/end are forwarded to the
// stable top-level mock functions so each test can control their behaviour independently.
vi.mock("@neondatabase/serverless", () => ({
  neonConfig: {},
  Pool: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      query: (...args: unknown[]) => mockQuery(...args),
      release: mockRelease,
    }),
    end: mockPoolEnd,
  })),
}));

vi.mock("ws", () => ({ default: class WebSocket {} }));

vi.mock("@/lib/api-token", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

import { Pool } from "@neondatabase/serverless";
import { POST, GET } from "@/app/api/admin/refresh-grid-mv/route";

const setupPoolMock = () => {
  // Regular function required — arrow functions are not constructible (new arrowFn() throws).
  vi.mocked(Pool).mockImplementation(function () {
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
