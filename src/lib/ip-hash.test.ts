// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, afterEach } from "vitest";

describe("hashIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is deterministic for the same ip and secret", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-secret-at-least-16-chars");
    const { hashIp } = await import("@/lib/ip-hash");
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
  });

  it("produces a different hash for a different secret", async () => {
    vi.stubEnv("IP_HASH_SECRET", "secret-one-at-least-16-chars");
    const { hashIp: hashA } = await import("@/lib/ip-hash");
    const a = hashA("1.2.3.4");

    vi.resetModules();
    vi.stubEnv("IP_HASH_SECRET", "secret-two-at-least-16-chars");
    const { hashIp: hashB } = await import("@/lib/ip-hash");
    const b = hashB("1.2.3.4");

    expect(a).not.toBe(b);
  });

  it("produces a different hash for a different namespace", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-secret-at-least-16-chars");
    const { hashIp } = await import("@/lib/ip-hash");
    expect(hashIp("1.2.3.4", "roadmap-vote")).not.toBe(hashIp("1.2.3.4", "other-feature"));
  });

  it("does not throw and returns a stable hash when IP_HASH_SECRET is unset in dev", async () => {
    vi.stubEnv("IP_HASH_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const { hashIp } = await import("@/lib/ip-hash");
    expect(() => hashIp("1.2.3.4")).not.toThrow();
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"));
  });

  it("warns once in production when IP_HASH_SECRET is unset", async () => {
    vi.stubEnv("IP_HASH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("@/lib/ip-hash");
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("handles the getIP() fallback value 'unknown' without throwing", async () => {
    vi.stubEnv("IP_HASH_SECRET", "test-secret-at-least-16-chars");
    const { hashIp } = await import("@/lib/ip-hash");
    expect(() => hashIp("unknown")).not.toThrow();
    expect(hashIp("unknown")).toBe(hashIp("unknown"));
  });
});
