// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Shared mock functions — same instance reused across all tests because the
// module-level `_redis` singleton is set on first getRedis() call and cached.
const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: () => ({ get: mockGet, set: mockSet }),
  },
}));

import { verifyPat, isValidLogin, normalizeLogin } from "@/lib/github-auth";

// ─── verifyPat() ─────────────────────────────────────────────────────────────

describe("verifyPat()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);       // cache miss by default
    mockSet.mockResolvedValue("OK");
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns null for an empty string", async () => {
    expect(await verifyPat("")).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns null for a PAT shorter than 10 characters", async () => {
    expect(await verifyPat("ghp_short")).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns login from Upstash cache on cache hit (unsigned)", async () => {
    mockGet.mockResolvedValue("octocat");
    const result = await verifyPat("ghp_validtoken1234");
    expect(result).toBe("octocat");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("calls GitHub API on cache miss and caches the result", async () => {
    mockGet.mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ login: "OctoCat" }),
    } as Response);

    const result = await verifyPat("ghp_validtoken1234");
    expect(result).toBe("octocat");  // normalizeLogin lowercases
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledOnce();
  });

  it("stores the login in cache with ex: 300 (5 minutes)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ login: "octocat" }),
    } as Response);

    await verifyPat("ghp_validtoken1234");
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringMatching(/^pat:/),
      "octocat",
      { ex: 300 },
    );
  });

  it("returns null when GitHub API returns non-200", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    expect(await verifyPat("ghp_invalidtoken1234")).toBeNull();
  });

  it("returns null when GitHub returns empty login", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ login: "" }),
    } as Response);
    expect(await verifyPat("ghp_validtoken1234")).toBeNull();
  });

  it("returns null when GitHub returns login that is not a string", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ login: 42 }),
    } as Response);
    expect(await verifyPat("ghp_validtoken1234")).toBeNull();
  });

  it("returns null when fetch throws (network error or timeout)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network timeout"));
    expect(await verifyPat("ghp_validtoken1234")).toBeNull();
  });

  it("proceeds to GitHub call if Upstash throws on get (fail-open)", async () => {
    mockGet.mockRejectedValue(new Error("Redis unavailable"));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ login: "octocat" }),
    } as Response);
    expect(await verifyPat("ghp_validtoken1234")).toBe("octocat");
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });
});

// ─── isValidLogin() ──────────────────────────────────────────────────────────

describe("isValidLogin()", () => {
  it("accepts a single-character login", () => {
    expect(isValidLogin("a")).toBe(true);
  });

  it("accepts a 39-character login (GitHub maximum)", () => {
    expect(isValidLogin("a".repeat(39))).toBe(true);
  });

  it("rejects a 40-character login", () => {
    expect(isValidLogin("a".repeat(40))).toBe(false);
  });

  it("rejects a login starting with a hyphen", () => {
    expect(isValidLogin("-invalid")).toBe(false);
  });

  it("rejects a login ending with a hyphen", () => {
    expect(isValidLogin("invalid-")).toBe(false);
  });

  it("accepts a login with a hyphen in the middle", () => {
    expect(isValidLogin("valid-login")).toBe(true);
  });

  it("accepts alphanumeric logins", () => {
    expect(isValidLogin("octocat123")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidLogin("")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isValidLogin(123 as unknown as string)).toBe(false);
  });

  it("rejects logins containing special characters", () => {
    expect(isValidLogin("evil@hack")).toBe(false);
    expect(isValidLogin("bad/path")).toBe(false);
  });
});

// ─── normalizeLogin() ────────────────────────────────────────────────────────

describe("normalizeLogin()", () => {
  it("lowercases the input", () => {
    expect(normalizeLogin("OctoCat")).toBe("octocat");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeLogin("  octocat  ")).toBe("octocat");
  });

  it("lowercases and trims together", () => {
    expect(normalizeLogin("  OCTOCAT  ")).toBe("octocat");
  });
});
