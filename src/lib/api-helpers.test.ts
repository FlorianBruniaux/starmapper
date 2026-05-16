// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-token", () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

import {
  jsonError,
  getIP,
  requireAdminAuth,
  extractGhToken,
  sanitizeError,
  logError,
} from "@/lib/api-helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const makeReq = (headers: Record<string, string> = {}, url = "http://localhost/api/test") =>
  new NextRequest(url, { headers });

// ── jsonError ────────────────────────────────────────────────────────────────

describe("jsonError()", () => {
  it("returns a Response with the given status", async () => {
    const res = jsonError("not_found", 404);
    expect(res.status).toBe(404);
  });

  it("body contains the error message", async () => {
    const res = jsonError("invalid_params", 400);
    const json = await res.json();
    expect(json.error).toBe("invalid_params");
  });
});

// ── getIP ────────────────────────────────────────────────────────────────────

describe("getIP()", () => {
  it("returns req.ip when set (Vercel edge)", () => {
    const req = makeReq() as NextRequest & { ip: string };
    req.ip = "1.2.3.4";
    expect(getIP(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    expect(getIP(makeReq({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("falls back to last segment of x-forwarded-for", () => {
    expect(getIP(makeReq({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(getIP(makeReq())).toBe("unknown");
  });
});

// ── sanitizeError ────────────────────────────────────────────────────────────

describe("sanitizeError()", () => {
  it("redacts postgres URLs", () => {
    const err = new Error("Failed: postgresql://user:pass@host/db");
    expect(sanitizeError(err)).toContain("[db-url-redacted]");
    expect(sanitizeError(err)).not.toContain("pass");
  });

  it("redacts Bearer tokens — replaces the whole header value", () => {
    const result = sanitizeError(new Error("auth: Bearer ghp_abcXYZ123 failed"));
    expect(result).not.toContain("ghp_abcXYZ123");
    expect(result).toContain("Bearer [redacted]");
  });

  it("redacts github_pat_ tokens", () => {
    expect(sanitizeError(new Error("github_pat_abc123_def"))).toContain("[gh-token-redacted]");
  });

  it("redacts gho_ tokens", () => {
    expect(sanitizeError(new Error("gho_abc123"))).toContain("[gh-token-redacted]");
  });

  it("redacts ghs_ tokens", () => {
    expect(sanitizeError(new Error("ghs_xyz789"))).toContain("[gh-token-redacted]");
  });

  it("handles non-Error values", () => {
    expect(sanitizeError("just a string")).toBe("just a string");
  });

  it("handles plain messages without secrets", () => {
    expect(sanitizeError(new Error("something failed"))).toBe("something failed");
  });
});

// ── logError ─────────────────────────────────────────────────────────────────

describe("logError()", () => {
  it("calls console.error with tag and sanitized message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("geocoder", new Error("oops"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[geocoder]"));
  });

  it("handles non-Error values without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logError("test", "string error")).not.toThrow();
    spy.mockRestore();
  });
});

// ── extractGhToken ───────────────────────────────────────────────────────────

describe("extractGhToken()", () => {
  it("returns the x-gh-token header when present", () => {
    vi.stubEnv("GITHUB_TOKEN", "server_token");
    expect(extractGhToken(makeReq({ "x-gh-token": "client_token" }))).toBe("client_token");
  });

  it("falls back to GITHUB_TOKEN env var", () => {
    vi.stubEnv("GITHUB_TOKEN", "server_token");
    expect(extractGhToken(makeReq())).toBe("server_token");
  });

  it("returns undefined when neither is set", () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(extractGhToken(makeReq())).toBeUndefined();
  });
});

// ── requireAdminAuth ─────────────────────────────────────────────────────────

describe("requireAdminAuth()", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SECRET", "supersecret");
    vi.stubEnv("ADMIN_ALLOWED_IPS", "");
  });

  it("returns null (pass) when secret matches and no IP allowlist", () => {
    const req = makeReq({ "x-admin-secret": "supersecret" });
    expect(requireAdminAuth(req)).toBeNull();
  });

  it("returns 404 when secret is wrong", () => {
    const req = makeReq({ "x-admin-secret": "wrong" });
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns 404 when secret header is absent", () => {
    const req = makeReq();
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns 404 when IP is not in allowlist", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", "10.0.0.1");
    const req = makeReq({ "x-admin-secret": "supersecret", "x-real-ip": "9.9.9.9" });
    const res = requireAdminAuth(req);
    expect(res?.status).toBe(404);
  });

  it("returns null when IP is in allowlist and secret matches", () => {
    vi.stubEnv("ADMIN_ALLOWED_IPS", "10.0.0.1");
    const req = makeReq({ "x-admin-secret": "supersecret", "x-real-ip": "10.0.0.1" });
    expect(requireAdminAuth(req)).toBeNull();
  });
});
