// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockGeoCacheDeleteMany = vi.fn();
const mockGeoCacheCount = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      deleteMany: (...args: unknown[]) => mockGeoCacheDeleteMany(...args),
      count: (...args: unknown[]) => mockGeoCacheCount(...args),
    },
  },
}));

import { POST } from "@/app/api/admin/clear-geocache/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/clear-geocache", { method: "POST" });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/clear-geocache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockRequireAdminAuth.mockReturnValue(null);
    mockGeoCacheDeleteMany.mockResolvedValue({ count: 12 });
    mockGeoCacheCount.mockResolvedValue(50000);
  });

  it("returns 404 in production environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 when admin auth fails (non-prod)", async () => {
    mockRequireAdminAuth.mockReturnValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
  });

  it("deletes null geocache entries and returns counts", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(12);
    expect(json.remaining).toBe(50000);
  });

  it("returns 500 when DB throws", async () => {
    mockGeoCacheDeleteMany.mockRejectedValue(new Error("connection lost"));
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
  });
});
