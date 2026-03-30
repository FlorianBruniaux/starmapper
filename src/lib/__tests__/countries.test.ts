// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { isCountry, normalizeCountry } from "@/lib/countries";

// ─── isCountry ────────────────────────────────────────────────────────────────

describe("isCountry", () => {
  describe("canonical ISO names", () => {
    it("recognizes lowercase country names", () => {
      expect(isCountry("france")).toBe(true);
      expect(isCountry("germany")).toBe(true);
      expect(isCountry("japan")).toBe(true);
      expect(isCountry("brazil")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isCountry("France")).toBe(true);
      expect(isCountry("FRANCE")).toBe(true);
      expect(isCountry("fRaNcE")).toBe(true);
    });

    it("trims whitespace before matching", () => {
      expect(isCountry("  france  ")).toBe(true);
      expect(isCountry("\tfrance\n")).toBe(true);
    });

    it("recognizes multi-word country names", () => {
      expect(isCountry("united states")).toBe(true);
      expect(isCountry("united kingdom")).toBe(true);
      expect(isCountry("south africa")).toBe(true);
      expect(isCountry("new zealand")).toBe(true);
    });
  });

  describe("common aliases", () => {
    it("recognizes 'usa' and 'us'", () => {
      expect(isCountry("usa")).toBe(true);
      expect(isCountry("us")).toBe(true);
      expect(isCountry("USA")).toBe(true);
    });

    it("recognizes 'uk'", () => {
      expect(isCountry("uk")).toBe(true);
      expect(isCountry("UK")).toBe(true);
    });

    it("recognizes England/Scotland/Wales as UK aliases", () => {
      expect(isCountry("england")).toBe(true);
      expect(isCountry("scotland")).toBe(true);
      expect(isCountry("wales")).toBe(true);
    });

    it("recognizes 'nz' for New Zealand", () => {
      expect(isCountry("nz")).toBe(true);
    });

    it("recognizes 'uae'", () => {
      expect(isCountry("uae")).toBe(true);
    });

    it("recognizes 'brasil' (common Portuguese misspelling)", () => {
      expect(isCountry("brasil")).toBe(true);
    });

    it("recognizes 'türkiye'", () => {
      expect(isCountry("türkiye")).toBe(true);
    });
  });

  describe("non-country values", () => {
    it("returns false for city names", () => {
      expect(isCountry("paris")).toBe(false);
      expect(isCountry("san francisco")).toBe(false);
      expect(isCountry("new york")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isCountry("")).toBe(false);
    });

    it("returns false for random strings", () => {
      expect(isCountry("xyz123")).toBe(false);
      expect(isCountry("somewhere")).toBe(false);
    });

    it("returns false for partial country name", () => {
      expect(isCountry("franc")).toBe(false);
      expect(isCountry("united")).toBe(false);
    });
  });
});

// ─── normalizeCountry ─────────────────────────────────────────────────────────

describe("normalizeCountry", () => {
  describe("alias resolution", () => {
    it("resolves 'usa' to 'United States'", () => {
      expect(normalizeCountry("usa")).toBe("United States");
    });

    it("resolves 'us' to 'United States'", () => {
      expect(normalizeCountry("us")).toBe("United States");
    });

    it("resolves 'uk' to 'United Kingdom'", () => {
      expect(normalizeCountry("uk")).toBe("United Kingdom");
    });

    it("resolves 'england' to 'United Kingdom'", () => {
      expect(normalizeCountry("england")).toBe("United Kingdom");
    });

    it("resolves 'holland' to 'Netherlands'", () => {
      expect(normalizeCountry("holland")).toBe("Netherlands");
    });

    it("resolves 'nz' to 'New Zealand'", () => {
      expect(normalizeCountry("nz")).toBe("New Zealand");
    });

    it("resolves 'türkiye' to 'Turkey'", () => {
      expect(normalizeCountry("türkiye")).toBe("Turkey");
    });

    it("resolves 'viet nam' to 'Vietnam'", () => {
      expect(normalizeCountry("viet nam")).toBe("Vietnam");
    });

    it("resolves 'czech republic' to 'Czechia'", () => {
      expect(normalizeCountry("czech republic")).toBe("Czechia");
    });

    it("resolves alias regardless of input casing", () => {
      expect(normalizeCountry("USA")).toBe("United States");
      expect(normalizeCountry("UK")).toBe("United Kingdom");
    });

    it("trims input before alias lookup", () => {
      expect(normalizeCountry("  usa  ")).toBe("United States");
    });
  });

  describe("title-case fallback for unknown values", () => {
    it("title-cases a plain country name not in alias map", () => {
      // "france" is not in ALIAS_MAP, so gets title-cased
      expect(normalizeCountry("france")).toBe("France");
    });

    it("title-cases multi-word values not in alias map", () => {
      expect(normalizeCountry("south africa")).toBe("South Africa");
    });

    it("title-cases city names passed in (no alias match)", () => {
      expect(normalizeCountry("new york city")).toBe("New York City");
    });

    it("handles already-cased input without double-casing", () => {
      expect(normalizeCountry("Germany")).toBe("Germany");
    });
  });
});
