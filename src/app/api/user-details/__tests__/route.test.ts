// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/user-details/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeReq = (body: unknown, ghToken?: string): NextRequest => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ghToken) headers["x-gh-token"] = ghToken;
  return new NextRequest("http://localhost/api/user-details", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const GH_USER_PAYLOAD = {
  login: "octocat",
  name: "The Octocat",
  email: null,
  bio: "GitHub mascot",
  company: "@github",
  blog: "https://github.blog",
  location: "San Francisco",
  twitter_username: null,
  followers: 10000,
  following: 9,
  public_repos: 8,
  avatar_url: "https://avatars.githubusercontent.com/u/583231",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/user-details", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(GH_USER_PAYLOAD), { status: 200 }),
    ));
    process.env.GITHUB_TOKEN = "test-env-token";
  });

  // ── Input validation ───────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when logins array is missing", async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(400);
    });

    it("returns 400 when logins is empty", async () => {
      const res = await POST(makeReq({ logins: [] }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when logins exceeds 200 entries", async () => {
      const logins = Array.from({ length: 201 }, (_, i) => `user${i}`);
      const res = await POST(makeReq({ logins }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when a login contains invalid chars", async () => {
      const res = await POST(makeReq({ logins: ["bad login!"] }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_login");
    });

    it("returns 401 when no GitHub token is available", async () => {
      delete process.env.GITHUB_TOKEN;
      const res = await POST(makeReq({ logins: ["octocat"] }));
      expect(res.status).toBe(401);
    });

    it("uses x-gh-token header over env token when provided", async () => {
      const res = await POST(makeReq({ logins: ["octocat"] }, "ghp_header_token"));
      expect(res.status).toBe(200);
      const callHeaders = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(callHeaders["Authorization"]).toContain("ghp_header_token");
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns 200 with users array", async () => {
      const res = await POST(makeReq({ logins: ["octocat"] }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.users)).toBe(true);
    });

    it("strips @ from company name", async () => {
      const json = await (await POST(makeReq({ logins: ["octocat"] }))).json();
      expect(json.users[0].company).toBe("github");
    });

    it("rejects non-https blog URL", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ ...GH_USER_PAYLOAD, blog: "http://insecure.com" }), { status: 200 }),
      );
      const json = await (await POST(makeReq({ logins: ["octocat"] }))).json();
      expect(json.users[0].blog).toBeNull();
    });

    it("skips users whose GitHub API call returns non-ok status", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
      const json = await (await POST(makeReq({ logins: ["ghost"] }))).json();
      expect(json.users).toHaveLength(0);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 for invalid JSON body", async () => {
      const req = new NextRequest("http://localhost/api/user-details", {
        method: "POST",
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });
});
