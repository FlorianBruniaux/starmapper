// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, expect, test } from "vitest";
import { withVerifyFullSsl } from "@/lib/pg-ssl";

describe("withVerifyFullSsl", () => {
  test("rewrites sslmode=require to verify-full", () => {
    const result = withVerifyFullSsl("postgresql://user:pw@host/db?sslmode=require");
    expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
  });

  test("rewrites sslmode=prefer to verify-full", () => {
    const result = withVerifyFullSsl("postgresql://user:pw@host/db?sslmode=prefer");
    expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
  });

  test("rewrites sslmode=verify-ca to verify-full", () => {
    const result = withVerifyFullSsl("postgresql://user:pw@host/db?sslmode=verify-ca");
    expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
  });

  test("leaves sslmode=verify-full untouched", () => {
    const result = withVerifyFullSsl("postgresql://user:pw@host/db?sslmode=verify-full");
    expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
  });

  test("leaves sslmode=disable untouched — explicit opt-out of SSL must not be overridden", () => {
    const result = withVerifyFullSsl("postgresql://user:pw@host/db?sslmode=disable");
    expect(new URL(result).searchParams.get("sslmode")).toBe("disable");
  });

  test("leaves a connection string with no sslmode param untouched", () => {
    const input = "postgresql://user:pw@host/db";
    const result = withVerifyFullSsl(input);
    expect(new URL(result).searchParams.has("sslmode")).toBe(false);
  });

  test("preserves other query params and connection details", () => {
    const result = withVerifyFullSsl(
      "postgresql://user:pw@host/db?sslmode=require&pgbouncer=true&connect_timeout=10",
    );
    const url = new URL(result);
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("connect_timeout")).toBe("10");
    expect(url.hostname).toBe("host");
    expect(url.pathname).toBe("/db");
  });

  test("returns the input untouched when it is not a parseable URL", () => {
    const input = "not-a-valid-connection-string";
    expect(withVerifyFullSsl(input)).toBe(input);
  });
});
