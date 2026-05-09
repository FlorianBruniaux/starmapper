// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { isCountry, normalizeCountry } from "@/lib/countries";

describe("isCountry()", () => {
  it("returns true for a canonical lowercase name", () => {
    expect(isCountry("france")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCountry("FRANCE")).toBe(true);
    expect(isCountry("France")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(isCountry("  germany  ")).toBe(true);
  });

  it("returns false for an unknown string", () => {
    expect(isCountry("unknown country xyz")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isCountry("")).toBe(false);
  });

  it("returns false for a city name", () => {
    expect(isCountry("Paris")).toBe(false);
  });
});

describe("normalizeCountry()", () => {
  it("resolves 'usa' alias → 'United States'", () => {
    expect(normalizeCountry("usa")).toBe("United States");
  });

  it("resolves 'uk' alias → 'United Kingdom'", () => {
    expect(normalizeCountry("uk")).toBe("United Kingdom");
  });

  it("resolves 'viet nam' alias → 'Vietnam'", () => {
    expect(normalizeCountry("viet nam")).toBe("Vietnam");
  });

  it("resolves 'türkiye' alias → 'Turkey'", () => {
    expect(normalizeCountry("türkiye")).toBe("Turkey");
  });

  it("resolves 'brasil' alias → 'Brazil'", () => {
    expect(normalizeCountry("brasil")).toBe("Brazil");
  });

  it("title-cases an unaliased canonical name", () => {
    expect(normalizeCountry("FRANCE")).toBe("France");
    expect(normalizeCountry("france")).toBe("France");
  });

  it("title-cases multi-word names", () => {
    expect(normalizeCountry("new zealand")).toBe("New Zealand");
  });

  it("resolves 'united states of america' alias", () => {
    expect(normalizeCountry("united states of america")).toBe("United States");
  });

  it("resolves 'russian federation' alias → 'Russia'", () => {
    expect(normalizeCountry("russian federation")).toBe("Russia");
  });
});
