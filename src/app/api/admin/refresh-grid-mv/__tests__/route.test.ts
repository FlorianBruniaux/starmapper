// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockExecuteRaw = vi.fn();
const mockSafeEqual = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args) },
}));

vi.mock("@/lib/api-token", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

import { POST, GET } from "@/app/api/admin/refresh-grid-mv/route";

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
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockRequireAdminAuth.mockReturnValue(null);
    mockExecuteRaw.mockResolvedValue(1);
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

  it("returns 200 with errors in results when DB throws during refresh", async () => {
    mockExecuteRaw.mockRejectedValue(new Error("MV locked"));
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.results.some((r: { error?: string }) => r.error !== undefined)).toBe(true);
  });
});

describe("GET /api/admin/refresh-grid-mv (cron)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockExecuteRaw.mockResolvedValue(1);
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
