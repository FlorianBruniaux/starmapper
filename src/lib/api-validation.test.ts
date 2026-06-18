// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { validateOwnerRepo, validateLogin } from "@/lib/api-validation";

// ─── validateOwnerRepo ────────────────────────────────────────────────────────

describe("validateOwnerRepo()", () => {
  it("returns normalised lowercase pair for valid owner and repo", () => {
    expect(validateOwnerRepo("Vercel", "Next.js")).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("returns null when owner is empty", () => {
    expect(validateOwnerRepo("", "repo")).toBeNull();
  });

  it("returns null when repo is empty", () => {
    expect(validateOwnerRepo("owner", "")).toBeNull();
  });

  it("returns null when owner is not a string", () => {
    expect(validateOwnerRepo(42, "repo")).toBeNull();
  });

  it("returns null for dot-only owner (path traversal guard)", () => {
    expect(validateOwnerRepo("..", "repo")).toBeNull();
  });

  it("returns null for dot-only repo", () => {
    expect(validateOwnerRepo("owner", ".")).toBeNull();
  });
});

// ─── validateLogin ────────────────────────────────────────────────────────────

describe("validateLogin()", () => {
  it("returns the login string unchanged for a valid single-segment login", () => {
    expect(validateLogin("gaearon")).toBe("gaearon");
  });

  it("preserves original casing (no lowercase)", () => {
    expect(validateLogin("Florian-B")).toBe("Florian-B");
  });

  it("accepts a single alphanumeric character", () => {
    expect(validateLogin("x")).toBe("x");
  });

  it("accepts a login with a hyphen in the middle", () => {
    expect(validateLogin("john-doe")).toBe("john-doe");
  });

  it("returns null for a login starting with a hyphen", () => {
    expect(validateLogin("-gaearon")).toBeNull();
  });

  it("returns null for a login ending with a hyphen", () => {
    expect(validateLogin("gaearon-")).toBeNull();
  });

  it("returns null for a login longer than 39 characters", () => {
    expect(validateLogin("a".repeat(40))).toBeNull();
  });

  it("accepts a login of exactly 39 characters", () => {
    expect(validateLogin("a".repeat(39))).toBe("a".repeat(39));
  });

  it("returns null when login is a number", () => {
    expect(validateLogin(123)).toBeNull();
  });

  it("returns null when login is null", () => {
    expect(validateLogin(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(validateLogin("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(validateLogin(undefined)).toBeNull();
  });
});
