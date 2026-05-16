// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  safeEqual,
  generateToken,
  verifyToken,
  TOKEN_TTL_MS,
  COOKIE_NAME,
} from "@/lib/api-token";

afterEach(() => vi.restoreAllMocks());

const SECRET = "test-secret-at-least-32-characters-long";

// ── constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("TOKEN_TTL_MS is 2 hours in ms", () => {
    expect(TOKEN_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("COOKIE_NAME is sm-token", () => {
    expect(COOKIE_NAME).toBe("sm-token");
  });
});

// ── safeEqual ────────────────────────────────────────────────────────────────

describe("safeEqual()", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(safeEqual("hello", "hell")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(safeEqual("", "x")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(safeEqual("", "")).toBe(true);
  });
});

// ── generateToken ────────────────────────────────────────────────────────────

describe("generateToken()", () => {
  it("returns a string with 3 dot-separated parts", async () => {
    const token = await generateToken(SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("encodes a recent timestamp in the first part", async () => {
    const before = Date.now();
    const token = await generateToken(SECRET);
    const ts = parseInt(token.split(".")[0], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("generates different tokens on successive calls (nonce randomness)", async () => {
    const t1 = await generateToken(SECRET);
    const t2 = await generateToken(SECRET);
    expect(t1).not.toBe(t2);
  });
});

// ── verifyToken ──────────────────────────────────────────────────────────────

describe("verifyToken()", () => {
  it("verifies a freshly generated token", async () => {
    const token = await generateToken(SECRET);
    expect(await verifyToken(token, SECRET)).toBe(true);
  });

  it("returns false for undefined token", async () => {
    expect(await verifyToken(undefined, SECRET)).toBe(false);
  });

  it("returns false when secret is empty", async () => {
    const token = await generateToken(SECRET);
    expect(await verifyToken(token, "")).toBe(false);
  });

  it("returns false for a token with wrong number of parts", async () => {
    expect(await verifyToken("only.two", SECRET)).toBe(false);
  });

  it("returns false for a tampered signature", async () => {
    const token = await generateToken(SECRET);
    const [ts, nonce] = token.split(".");
    const tampered = `${ts}.${nonce}.deadbeef`;
    expect(await verifyToken(tampered, SECRET)).toBe(false);
  });

  it("returns false for an expired token", async () => {
    const expiredTs = Date.now() - TOKEN_TTL_MS - 1;
    const token = await generateToken(SECRET);
    const [, nonce, sig] = token.split(".");
    const expired = `${expiredTs}.${nonce}.${sig}`;
    expect(await verifyToken(expired, SECRET)).toBe(false);
  });
});
