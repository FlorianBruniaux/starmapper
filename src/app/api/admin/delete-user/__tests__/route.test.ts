// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockDeletionLogCreate = vi.fn();
const mockDeletionLogUpdate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockStarDeleteMany = vi.fn();
const mockUserDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    deletionLog: {
      create: (...args: unknown[]) => mockDeletionLogCreate(...args),
      update: (...args: unknown[]) => mockDeletionLogUpdate(...args),
    },
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      delete: (...args: unknown[]) => mockUserDelete(...args),
    },
    starEvent: {
      deleteMany: (...args: unknown[]) => mockStarDeleteMany(...args),
    },
  },
}));

import { POST } from "@/app/api/admin/delete-user/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown): NextRequest =>
  new NextRequest("http://localhost/api/admin/delete-user", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/delete-user", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireAdminAuth.mockReturnValue(null);
    mockDeletionLogCreate.mockResolvedValue({ id: 42 });
    mockDeletionLogUpdate.mockResolvedValue({});
    mockUserFindUnique.mockResolvedValue({ login: "octocat" });
    mockStarDeleteMany.mockResolvedValue({ count: 10 });
    mockUserDelete.mockResolvedValue({});
    // $transaction receives an array of already-started promises and resolves them together.
    mockTransaction.mockImplementation((ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    );
  });

  it("returns 404 when admin auth fails", async () => {
    mockRequireAdminAuth.mockReturnValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const res = await POST(makeReq({ login: "octocat" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid login (spaces)", async () => {
    const res = await POST(makeReq({ login: "bad user" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty login", async () => {
    const res = await POST(makeReq({ login: "" }));
    expect(res.status).toBe(400);
  });

  it("returns { ok: true, status: 'not_found' } when user does not exist in DB", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ login: "ghost" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("not_found");
  });

  it("deletes user and star events atomically, returns counts", async () => {
    const res = await POST(makeReq({ login: "octocat" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.eventsDeleted).toBe(10);
    expect(json.login).toBe("octocat");
  });

  it("returns 500 when DB throws during deletion", async () => {
    mockStarDeleteMany.mockRejectedValue(new Error("FK constraint"));
    const res = await POST(makeReq({ login: "octocat" }));
    expect(res.status).toBe(500);
  });
});
