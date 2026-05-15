// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdminAuth = vi.fn();
const mockGeoCacheUpsert = vi.fn();
const mockGeoCacheCount = vi.fn();

vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  jsonError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    geoCache: {
      upsert: (...args: unknown[]) => mockGeoCacheUpsert(...args),
      count: (...args: unknown[]) => mockGeoCacheCount(...args),
    },
  },
}));

import { POST } from "@/app/api/admin/import-geocache/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown, headers: Record<string, string> = {}): NextRequest => {
  const bodyStr = JSON.stringify(body);
  return new NextRequest("http://localhost/api/admin/import-geocache", {
    method: "POST",
    body: bodyStr,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(bodyStr)),
      ...headers,
    },
  });
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/admin/import-geocache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockRequireAdminAuth.mockReturnValue(null);
    mockGeoCacheUpsert.mockResolvedValue({});
    mockGeoCacheCount.mockResolvedValue(51000);
  });

  it("returns 404 in production environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(makeReq({}));
    expect(res.status).toBe(404);
  });

  it("returns 404 when admin auth fails", async () => {
    mockRequireAdminAuth.mockReturnValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const res = await POST(makeReq({}));
    expect(res.status).toBe(404);
  });

  it("returns 413 when content-length exceeds 5MB", async () => {
    const res = await POST(makeReq({}, { "Content-Length": String(6 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("upserts entries and returns inserted count", async () => {
    const entries = { paris: [48.85, 2.35] as [number, number], london: [51.5, -0.12] as [number, number] };
    const res = await POST(makeReq(entries));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(json.total).toBe(51000);
  });

  it("handles null entries (unknown location)", async () => {
    const entries = { "unknown place": null };
    const res = await POST(makeReq(entries));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inserted).toBe(1);
  });
});
