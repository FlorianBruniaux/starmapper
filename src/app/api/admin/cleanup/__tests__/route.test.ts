// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockUserFindMany = vi.fn();
const mockStarDeleteMany = vi.fn();
const mockUserDeleteMany = vi.fn();
const mockSafeEqual = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      deleteMany: (...args: unknown[]) => mockUserDeleteMany(...args),
    },
    starEvent: {
      deleteMany: (...args: unknown[]) => mockStarDeleteMany(...args),
    },
  },
}));

vi.mock("@/lib/api-token", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

import { POST, GET } from "@/app/api/admin/cleanup/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makePost = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/cleanup", { method: "POST" });

const makeGet = (authHeader?: string): NextRequest =>
  new NextRequest("http://localhost/api/admin/cleanup", {
    headers: authHeader ? { authorization: authHeader } : {},
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockRequireAdminAuth.mockReturnValue(null); // auth ok
    mockUserFindMany.mockResolvedValue([]);     // no stale users
    mockStarDeleteMany.mockResolvedValue({ count: 0 });
    mockUserDeleteMany.mockResolvedValue({ count: 0 });
    mockSafeEqual.mockReturnValue(true);
  });

  it("returns 401 when admin auth fails", async () => {
    mockRequireAdminAuth.mockReturnValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it("returns { usersDeleted: 0 } when no stale users", async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usersDeleted).toBe(0);
  });

  it("deletes stale users and returns counts", async () => {
    mockUserFindMany.mockResolvedValue([{ login: "olduser" }]);
    mockStarDeleteMany.mockResolvedValue({ count: 5 });
    mockUserDeleteMany.mockResolvedValue({ count: 1 });
    const res = await POST(makePost());
    const json = await res.json();
    expect(json.usersDeleted).toBe(1);
    expect(json.eventsDeleted).toBe(5);
  });

  it("returns 500 when DB throws", async () => {
    mockUserFindMany.mockRejectedValue(new Error("DB down"));
    const res = await POST(makePost());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/admin/cleanup (cron)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockUserFindMany.mockResolvedValue([]);
    mockSafeEqual.mockReturnValue(false);
  });

  it("returns 401 when CRON_SECRET is not set", async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret does not match", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    mockSafeEqual.mockReturnValue(false);
    const res = await GET(makeGet("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("runs cleanup when CRON_SECRET matches", async () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    mockSafeEqual.mockReturnValue(true);
    const res = await GET(makeGet("Bearer correct-secret"));
    expect(res.status).toBe(200);
  });
});
