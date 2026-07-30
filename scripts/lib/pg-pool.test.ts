// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, expect, test, vi, beforeEach } from "vitest";

const poolCtorSpy = vi.fn();
const withVerifyFullSslSpy = vi.fn((connectionString: string) => `verified:${connectionString}`);

vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(config: unknown) {
        poolCtorSpy(config);
      }
    },
  },
}));

vi.mock("@/lib/pg-ssl", () => ({
  withVerifyFullSsl: (connectionString: string) => withVerifyFullSslSpy(connectionString),
}));

const { createScriptPool } = await import("./pg-pool");

describe("createScriptPool", () => {
  beforeEach(() => {
    poolCtorSpy.mockClear();
    withVerifyFullSslSpy.mockClear();
  });

  test("rewrites the connection string through withVerifyFullSsl", () => {
    createScriptPool("postgresql://user:pw@host/db?sslmode=require");

    expect(withVerifyFullSslSpy).toHaveBeenCalledWith("postgresql://user:pw@host/db?sslmode=require");
    expect(poolCtorSpy).toHaveBeenCalledWith({
      connectionString: "verified:postgresql://user:pw@host/db?sslmode=require",
    });
  });

  test("preserves additional pool options alongside the rewritten connection string", () => {
    createScriptPool("postgresql://user:pw@host/db", { options: "-c statement_timeout=0", max: 1 });

    expect(poolCtorSpy).toHaveBeenCalledWith({
      connectionString: "verified:postgresql://user:pw@host/db",
      options: "-c statement_timeout=0",
      max: 1,
    });
  });
});
