// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock is hoisted to the top of the file — the factory cannot reference variables
// declared below. Use vi.hoisted() to declare mocks that are safe to reference here.
const { upsertMock } = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ type: "repo", slug: "test/test", count: 1 }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    pageView: {
      upsert: upsertMock,
    },
  },
}));

import { POST } from "@/app/api/track/route";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — build a NextRequest from a plain object body
// ─────────────────────────────────────────────────────────────────────────────
const makeRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  upsertMock.mockClear();
  upsertMock.mockResolvedValue({ type: "repo", slug: "test/test", count: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Valid inputs — should return { ok: true } and call prisma
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/track — valid inputs", () => {
  it("accepts a valid repo slug (owner/repo format)", async () => {
    const res = await POST(makeRequest({ type: "repo", slug: "facebook/react" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("accepts a valid profile slug (GitHub login format)", async () => {
    const res = await POST(makeRequest({ type: "profile", slug: "torvalds" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("accepts a valid feed_rss slug (GitHub login format)", async () => {
    const res = await POST(makeRequest({ type: "feed_rss", slug: "sindresorhus" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("uses UTC midnight as the date (no time component in upsert key)", async () => {
    await POST(makeRequest({ type: "repo", slug: "vercel/next.js" }));
    const callArgs = upsertMock.mock.calls[0][0];
    const upsertDate: Date = callArgs.where.type_slug_date.date;
    expect(upsertDate.getUTCHours()).toBe(0);
    expect(upsertDate.getUTCMinutes()).toBe(0);
    expect(upsertDate.getUTCSeconds()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid inputs — should return 400 { error: "invalid_params" }
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/track — invalid type", () => {
  it("rejects an unknown type string", async () => {
    const res = await POST(makeRequest({ type: "pageview", slug: "facebook/react" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a missing type field", async () => {
    const res = await POST(makeRequest({ slug: "facebook/react" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });

  it("rejects a non-string type (number)", async () => {
    const res = await POST(makeRequest({ type: 42, slug: "facebook/react" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });
});

describe("POST /api/track — invalid slug", () => {
  it("rejects a repo slug without slash", async () => {
    const res = await POST(makeRequest({ type: "repo", slug: "facebook" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });

  it("rejects a repo slug with path traversal characters", async () => {
    const res = await POST(makeRequest({ type: "repo", slug: "../../../etc/passwd" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });

  it("rejects a profile slug with a slash (repo format used as profile slug)", async () => {
    const res = await POST(makeRequest({ type: "profile", slug: "some/repo" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });

  it("rejects an empty slug string", async () => {
    const res = await POST(makeRequest({ type: "repo", slug: "" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_params");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resilience — DB errors must never leak as 500
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/track — DB error resilience", () => {
  it("returns { ok: true } even when the Prisma upsert throws (fire-and-forget contract)", async () => {
    upsertMock.mockRejectedValueOnce(new Error("DB connection refused"));

    const res = await POST(makeRequest({ type: "repo", slug: "rails/rails" }));
    const body = await res.json();
    // The route catches all errors and always returns { ok: true }
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });
});
