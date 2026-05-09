// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/vitals/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Vitals = {
  name?: unknown;
  value?: unknown;
  rating?: unknown;
  delta?: unknown;
  id?: unknown;
  path?: unknown;
  navigationType?: unknown;
};

const makeReq = (body: Vitals): NextRequest =>
  new NextRequest("http://localhost/api/vitals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const VALID: Vitals = { name: "LCP", value: 1200, rating: "good", delta: 100, id: "v3-abc", path: "/about" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/vitals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for an unknown metric name", async () => {
      const res = await POST(makeReq({ ...VALID, name: "TTI" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_metric");
    });

    it("returns 400 when value is Infinity", async () => {
      const res = await POST(makeReq({ ...VALID, value: Infinity }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_value");
    });

    it("returns 400 when value is NaN", async () => {
      const res = await POST(makeReq({ ...VALID, value: NaN }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for an unknown rating value", async () => {
      const res = await POST(makeReq({ ...VALID, rating: "excellent" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_rating");
    });

    it("returns 400 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost/api/vitals", {
        method: "POST",
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("accepts all valid metric names", async () => {
      for (const name of ["FCP", "LCP", "CLS", "TTFB", "FID", "INP"]) {
        const res = await POST(makeReq({ ...VALID, name }));
        expect(res.status).toBe(200);
      }
    });

    it("accepts all valid rating values", async () => {
      for (const rating of ["good", "needs-improvement", "poor"]) {
        const res = await POST(makeReq({ ...VALID, rating }));
        expect(res.status).toBe(200);
      }
    });
  });

  // ── Log injection guard (MED-4 regression) ────────────────────────────────

  describe("log injection guard (MED-4)", () => {
    it("strips newline characters from path before logging", async () => {
      const consoleSpy = vi.mocked(console.log);
      await POST(makeReq({ ...VALID, path: "/page\nINJECTED_LOG_LINE" }));
      const logged = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(logged);
      expect(parsed.path).not.toContain("\n");
      expect(parsed.path).toContain(" ");
    });

    it("strips tab and carriage return from path", async () => {
      const consoleSpy = vi.mocked(console.log);
      await POST(makeReq({ ...VALID, path: "/page\r\t" }));
      const logged = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(logged);
      expect(parsed.path).not.toContain("\r");
      expect(parsed.path).not.toContain("\t");
    });

    it("truncates path to 200 characters", async () => {
      const consoleSpy = vi.mocked(console.log);
      await POST(makeReq({ ...VALID, path: "a".repeat(300) }));
      const logged = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(logged);
      expect(parsed.path.length).toBeLessThanOrEqual(200);
    });

    it("uses 'navigate' as default navigationType when not a string", async () => {
      const consoleSpy = vi.mocked(console.log);
      await POST(makeReq({ ...VALID, navigationType: null }));
      const logged = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(logged);
      expect(parsed.navigationType).toBe("navigate");
    });
  });

  // ── Successful log ────────────────────────────────────────────────────────

  describe("successful log", () => {
    it("returns 200 with ok:true", async () => {
      const res = await POST(makeReq(VALID));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("logs valid structured JSON to console", async () => {
      const consoleSpy = vi.mocked(console.log);
      await POST(makeReq(VALID));
      expect(consoleSpy).toHaveBeenCalledOnce();
      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.type).toBe("web_vital");
      expect(parsed.name).toBe("LCP");
    });
  });
});
