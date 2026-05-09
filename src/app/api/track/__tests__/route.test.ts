// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPageViewUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    pageView: { upsert: (...args: unknown[]) => mockPageViewUpsert(...args) },
  },
}));

import { POST } from "@/app/api/track/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown): NextRequest =>
  new NextRequest("http://localhost/api/track", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/track", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPageViewUpsert.mockResolvedValue(undefined);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for unknown type", async () => {
      const res = await POST(makeReq({ type: "unknown", slug: "foo/bar" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid repo slug (no slash)", async () => {
      const res = await POST(makeReq({ type: "repo", slug: "noslash" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid profile slug (spaces)", async () => {
      const res = await POST(makeReq({ type: "profile", slug: "bad user" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing type", async () => {
      const res = await POST(makeReq({ slug: "foo/bar" }));
      expect(res.status).toBe(400);
    });
  });

  // ── Successful tracking ───────────────────────────────────────────────────

  describe("successful tracking", () => {
    it("returns { ok: true } for valid repo slug", async () => {
      const res = await POST(makeReq({ type: "repo", slug: "facebook/react" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("returns { ok: true } for valid profile slug", async () => {
      const res = await POST(makeReq({ type: "profile", slug: "octocat" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("returns { ok: true } for valid feed_rss slug", async () => {
      const res = await POST(makeReq({ type: "feed_rss", slug: "octocat" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  // ── Error resilience ──────────────────────────────────────────────────────

  describe("error resilience", () => {
    it("returns { ok: true } even when DB throws (swallows errors)", async () => {
      mockPageViewUpsert.mockRejectedValue(new Error("DB down"));
      const res = await POST(makeReq({ type: "repo", slug: "facebook/react" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });
});
