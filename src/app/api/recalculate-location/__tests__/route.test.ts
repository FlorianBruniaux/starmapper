// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockGeoCacheDeleteMany = vi.fn();
const mockGeocode = vi.fn();
const mockVerifyToken = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    gitHubUser: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    geoCache: { deleteMany: (...args: unknown[]) => mockGeoCacheDeleteMany(...args) },
  },
}));

vi.mock("@/lib/geocoder", () => ({
  geocode: (...args: unknown[]) => mockGeocode(...args),
}));

vi.mock("@/lib/api-token", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  COOKIE_NAME: "sm-token",
}));

import { POST } from "@/app/api/recalculate-location/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown, cookies: Record<string, string> = {}): NextRequest => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (Object.keys(cookies).length > 0) {
    headers["Cookie"] = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  return new NextRequest("http://localhost/api/recalculate-location", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/recalculate-location", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    mockUserFindUnique.mockResolvedValue({ location: "Paris, France" });
    mockGeoCacheDeleteMany.mockResolvedValue({ count: 1 });
    mockUserUpdate.mockResolvedValue({});
    mockGeocode.mockResolvedValue([48.85, 2.35]);
    mockVerifyToken.mockResolvedValue(true);
  });

  // ── SM_TOKEN_SECRET guard ─────────────────────────────────────────────────

  describe("token guard", () => {
    it("returns 403 when SM_TOKEN_SECRET is set and token is invalid", async () => {
      vi.stubEnv("SM_TOKEN_SECRET", "supersecret");
      mockVerifyToken.mockResolvedValue(false);
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(403);
    });

    it("proceeds normally when SM_TOKEN_SECRET is not set (no guard)", async () => {
      // SM_TOKEN_SECRET unset — no guard applied
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(200);
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for missing login", async () => {
      const res = await POST(makeReq({ login: "" }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost/api/recalculate-location", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ── User not found ────────────────────────────────────────────────────────

  describe("user not found", () => {
    it("returns 404 when user is not in DB", async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const res = await POST(makeReq({ login: "unknown" }));
      expect(res.status).toBe(404);
    });

    it("returns 404 when user has no location", async () => {
      mockUserFindUnique.mockResolvedValue({ location: null });
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(404);
    });
  });

  // ── Geocode results ───────────────────────────────────────────────────────

  describe("geocode results", () => {
    it("returns lat/lng when geocode succeeds", async () => {
      mockGeocode.mockResolvedValue([48.85, 2.35]);
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.lat).toBe(48.85);
      expect(json.lng).toBe(2.35);
    });

    it("returns { unmapped: true } when geocode returns null", async () => {
      mockGeocode.mockResolvedValue(null);
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.unmapped).toBe(true);
    });

    it("succeeds even when geoCache.deleteMany fails (non-fatal)", async () => {
      mockGeoCacheDeleteMany.mockRejectedValue(new Error("DB error"));
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(200);
    });

    it("succeeds even when gitHubUser.update fails (non-fatal)", async () => {
      mockUserUpdate.mockRejectedValue(new Error("DB error"));
      const res = await POST(makeReq({ login: "octocat" }));
      expect(res.status).toBe(200);
    });
  });
});
