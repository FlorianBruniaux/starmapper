// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockVerifyPat = vi.fn();

vi.mock("@/lib/github-auth", () => ({
  verifyPat: (...args: unknown[]) => mockVerifyPat(...args),
}));

const mockNewsFindUnique = vi.fn();
const mockNewsUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    news: {
      findUnique: (...args: unknown[]) => mockNewsFindUnique(...args),
      update: (...args: unknown[]) => mockNewsUpdate(...args),
    },
  },
}));

import { DELETE } from "@/app/api/news/item/[id]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (
  id: string,
  pat?: string,
): [NextRequest, { params: Promise<{ id: string }> }] => {
  const headers: Record<string, string> = {};
  if (pat) headers["x-gh-token"] = pat;
  return [
    new NextRequest(`http://localhost/api/news/item/${id}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id }) },
  ];
};

const AUTHOR = "octocat";
const newsRow = { authorLogin: AUTHOR, deletedAt: null };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DELETE /api/news/item/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockVerifyPat.mockResolvedValue(AUTHOR);
    mockNewsFindUnique.mockResolvedValue(newsRow);
    mockNewsUpdate.mockResolvedValue(undefined);
  });

  // ── PAT authentication ────────────────────────────────────────────────────

  describe("PAT authentication", () => {
    it("returns 401 when x-gh-token header is absent", async () => {
      const [req, ctx] = makeReq("1");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("pat_required");
    });

    it("returns 401 when PAT is invalid", async () => {
      mockVerifyPat.mockResolvedValue(null);
      const [req, ctx] = makeReq("1", "ghp_invalid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("pat_invalid");
    });
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 for non-numeric id", async () => {
      const [req, ctx] = makeReq("not-a-number", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_id");
    });
  });

  // ── Ownership and state ───────────────────────────────────────────────────

  describe("ownership and state checks", () => {
    it("returns 404 when the news item does not exist", async () => {
      mockNewsFindUnique.mockResolvedValue(null);
      const [req, ctx] = makeReq("99", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(404);
    });

    it("returns 410 when the item is already soft-deleted", async () => {
      mockNewsFindUnique.mockResolvedValue({ authorLogin: AUTHOR, deletedAt: new Date() });
      const [req, ctx] = makeReq("1", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(410);
      expect((await res.json()).error).toBe("already_deleted");
    });

    it("returns 403 when authenticated user is not the author", async () => {
      mockVerifyPat.mockResolvedValue("other-user");
      const [req, ctx] = makeReq("1", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("forbidden");
    });
  });

  // ── Successful delete ─────────────────────────────────────────────────────

  describe("successful delete", () => {
    it("returns 200 with ok:true", async () => {
      const [req, ctx] = makeReq("1", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it("performs a soft delete (sets deletedAt, does not remove row)", async () => {
      const [req, ctx] = makeReq("1", "ghp_valid");
      await DELETE(req, ctx);
      expect(mockNewsUpdate).toHaveBeenCalledOnce();
      const call = mockNewsUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 when DB throws", async () => {
      mockNewsFindUnique.mockRejectedValue(new Error("timeout"));
      const [req, ctx] = makeReq("1", "ghp_valid");
      const res = await DELETE(req, ctx);
      expect(res.status).toBe(500);
    });
  });
});
