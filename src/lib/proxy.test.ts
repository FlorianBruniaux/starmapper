// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

vi.mock("@/lib/api-token", () => ({
  generateToken: vi.fn(),
  verifyToken: vi.fn(),
  getSmSecrets: () => [],
  COOKIE_NAME: "sm-token",
  TOKEN_TTL_MS: 2 * 60 * 60 * 1000,
}));

vi.mock("@/lib/api-helpers", () => ({
  getIP: () => "1.2.3.4",
}));

describe("proxy.ts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // HI-1 root cause: two limiters sharing a Redis key prefix but different window sizes
  // silently corrupt each other's counters, producing intermittent 429s that neither
  // limiter's own config explains. This test fails fast if a future edit reintroduces
  // that collision anywhere in POST_ROUTES or TIER_LIMITERS.
  describe("limiter prefixes", () => {
    it("registers every limiter prefix exactly once", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      const prefixes = __TEST_ONLY__.registeredPrefixes;
      expect(prefixes.length).toBeGreaterThan(0);
      const duplicates = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
      expect(duplicates).toEqual([]);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });

  // HI-3: dynamic path segments (owner/repo/login) must collapse to a bounded template
  // before being used as part of a rate-limit key, or an IP can dodge its quota forever
  // by varying which profile/repo it requests, and the Redis key space grows unbounded.
  describe("routeKey", () => {
    it("collapses dynamic owner/repo/login segments to *", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.routeKey("/api/profile/torvalds")).toBe("/api/profile/*");
      expect(__TEST_ONLY__.routeKey("/api/stats/facebook/react/top-users")).toBe(
        "/api/stats/*/*/top-users",
      );
      expect(__TEST_ONLY__.routeKey("/api/watch/facebook/react")).toBe("/api/watch/*/*");
    });

    it("leaves fully-static paths unchanged", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.routeKey("/api/users/autocomplete")).toBe("/api/users/autocomplete");
      expect(__TEST_ONLY__.routeKey("/api/explore/geocode")).toBe("/api/explore/geocode");
    });

    it("maps distinct owners/repos to the same bounded key", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      const a = __TEST_ONLY__.routeKey("/api/profile/torvalds");
      const b = __TEST_ONLY__.routeKey("/api/profile/octocat");
      expect(a).toBe(b);
    });
  });

  // HI-4: /api/watch burns the shared server GITHUB_TOKEN and must require the sm-token
  // session (strict-get), not fall through to the unauthenticated moderate-get catch-all.
  describe("classifyRoute", () => {
    it("classifies /api/watch/[owner]/[repo] as strict-get", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/watch/facebook/react")).toBe("strict-get");
    });

    it("classifies badge/map-image/geo as public", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/badge/facebook/react")).toBe("public");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/map-image/facebook/react")).toBe("public");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/geo/facebook/react")).toBe("public");
    });

    it("classifies MCP contributors/dependencies/followers as mcp-github", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/mcp/contributors/facebook/react")).toBe(
        "mcp-github",
      );
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/mcp/followers/torvalds")).toBe("mcp-github");
    });

    it("classifies any non-GET/HEAD method as post", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.classifyRoute("POST", "/api/chunk")).toBe("post");
      expect(__TEST_ONLY__.classifyRoute("DELETE", "/api/news/item/1")).toBe("post");
    });

    it("classifies GET /api/roadmap-vote as moderate-get and POST as post", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      expect(__TEST_ONLY__.classifyRoute("GET", "/api/roadmap-vote")).toBe("moderate-get");
      expect(__TEST_ONLY__.classifyRoute("POST", "/api/roadmap-vote")).toBe("post");
    });
  });

  // MED-1 / LOW-7 / LOW-9: pin the CSP shape so a future edit can't silently reopen the
  // wss: exfiltration channel in production or drop the object-src/style-src fallback.
  describe("buildCsp", () => {
    it("omits wss: and unused geocoding hosts from connect-src in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const { __TEST_ONLY__ } = await import("@/proxy");
      const csp = __TEST_ONLY__.buildCsp("test-nonce");
      const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src"));
      expect(connectSrc).toBeDefined();
      expect(connectSrc).not.toContain("wss:");
      expect(connectSrc).not.toContain("geoapify.com");
      expect(connectSrc).not.toContain("nominatim.openstreetmap.org");
    });

    it("includes wss: in connect-src in development only", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const { __TEST_ONLY__ } = await import("@/proxy");
      const csp = __TEST_ONLY__.buildCsp("test-nonce");
      const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src"));
      expect(connectSrc).toContain("wss:");
    });

    it("sets object-src 'none' and a style-src fallback alongside style-src-elem/attr", async () => {
      const { __TEST_ONLY__ } = await import("@/proxy");
      const csp = __TEST_ONLY__.buildCsp("test-nonce");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("style-src-elem 'self' 'nonce-test-nonce'");
      expect(csp).toContain("style-src-attr 'unsafe-inline'");
      expect(csp).toContain("style-src 'self' 'nonce-test-nonce' 'unsafe-inline'");
    });
  });
});
