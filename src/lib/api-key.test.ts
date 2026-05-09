// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { hashApiKey } from "@/lib/api-key";

describe("hashApiKey()", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    expect(hashApiKey("some-key")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces same hash", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });

  it("matches a known SHA-256 vector", () => {
    // SHA-256("abc") — canonical test vector, confirmed with Node crypto
    expect(hashApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
