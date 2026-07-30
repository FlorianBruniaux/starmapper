// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockStargazerCacheFindMany = vi.fn();
const mockGeoCacheCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    stargazerCache: { findMany: (...args: unknown[]) => mockStargazerCacheFindMany(...args) },
    geoCache: { count: (...args: unknown[]) => mockGeoCacheCount(...args) },
  },
}));

const mockRequireAdminAuth = vi.fn();
vi.mock("@/lib/api-helpers", () => ({
  requireAdminAuth: (...args: unknown[]) => mockRequireAdminAuth(...args),
  logError: vi.fn(),
}));

const mockSafeEqual = vi.fn();
vi.mock("@/lib/api-token", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

const mockGetWeeklyRoadmapRecap = vi.fn();
vi.mock("@/lib/roadmap-vote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/roadmap-vote")>();
  return { ...actual, getWeeklyRoadmapRecap: (...args: unknown[]) => mockGetWeeklyRoadmapRecap(...args) };
});

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

import { POST } from "@/app/api/admin/daily-digest/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (): NextRequest =>
  new NextRequest("http://localhost/api/admin/daily-digest", { method: "POST" });

const emptyRecap = { newVotesCount: 0, tallies: { A: 0, B: 0, C: 0, D: 0 }, totalVoters: 0, contacts: [] };

describe("POST /api/admin/daily-digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockRequireAdminAuth.mockReturnValue(null);
    mockQueryRaw.mockResolvedValue([]);
    mockStargazerCacheFindMany.mockResolvedValue([]);
    mockGeoCacheCount.mockResolvedValue(0);
    mockGetWeeklyRoadmapRecap.mockResolvedValue(emptyRecap);
    mockSend.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("returns the admin auth error response unchanged when unauthorized", async () => {
    const denied = NextResponse.json({ error: "forbidden" }, { status: 403 });
    mockRequireAdminAuth.mockReturnValue(denied);
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips the weekly roadmap recap on a non-Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00Z")); // Tuesday
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockGetWeeklyRoadmapRecap).not.toHaveBeenCalled();
    const html = mockSend.mock.calls[0][0].html as string;
    expect(html).not.toContain("Roadmap vote");
  });

  it("includes the weekly roadmap recap on a Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T08:00:00Z")); // Monday
    mockGetWeeklyRoadmapRecap.mockResolvedValue({
      newVotesCount: 2,
      tallies: { A: 2, B: 1, C: 1, D: 0 },
      totalVoters: 2,
      contacts: [
        { options: ["A", "B"], email: "voter@example.com", name: "Ada", message: "hi", createdAt: new Date() },
      ],
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(mockGetWeeklyRoadmapRecap).toHaveBeenCalledOnce();
    const html = mockSend.mock.calls[0][0].html as string;
    expect(html).toContain("Roadmap vote, 7 derniers jours");
    expect(html).toContain("2 nouveau(x) vote(s)");
    expect(html).toContain("voter@example.com");
    expect(html).toContain("Ada");
  });

  it("HTML-escapes a malicious contact name in the weekly recap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T08:00:00Z")); // Monday
    mockGetWeeklyRoadmapRecap.mockResolvedValue({
      newVotesCount: 1,
      tallies: { A: 1, B: 0, C: 0, D: 0 },
      totalVoters: 1,
      contacts: [
        { options: ["A"], email: "voter@example.com", name: "<img src=x onerror=alert(1)>", message: null, createdAt: new Date() },
      ],
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const html = mockSend.mock.calls[0][0].html as string;
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("returns 500 when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
  });
});
