// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/github", () => ({
  fetchRepoDependencies: vi.fn(),
  GitHubRateLimitError: class GitHubRateLimitError extends Error {
    resetAt: number;
    constructor(resetAt: number) { super("rate_limited"); this.resetAt = resetAt; }
  },
  GitHubTokenInvalidError: class GitHubTokenInvalidError extends Error {
    constructor() { super("token_invalid"); }
  },
}));

import {
  fetchRepoDependencies,
  GitHubRateLimitError,
  GitHubTokenInvalidError,
} from "@/lib/github";
import { GET } from "./route";

const makeParams = (owner = "vercel", repo = "next.js") =>
  Promise.resolve({ owner, repo });

const makeReq = (owner = "vercel", repo = "next.js") =>
  new NextRequest(`http://localhost/api/mcp/dependencies/${owner}/${repo}`);

const makeDep = (name: string, ecosystem = "npm", version = "1.0.0") => ({
  name,
  ecosystem,
  version,
});

const makeResult = (overrides: Partial<{
  dependencies: ReturnType<typeof makeDep>[];
  totalCount: number;
  disabled: boolean;
  quotaRemaining: number | null;
}> = {}) => ({
  dependencies: overrides.dependencies ?? [makeDep("react"), makeDep("typescript")],
  totalCount: overrides.totalCount ?? (overrides.dependencies?.length ?? 2),
  disabled: overrides.disabled ?? false,
  quotaRemaining: overrides.quotaRemaining ?? 4000,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mcp/dependencies/[owner]/[repo]", () => {
  it("returns 400 for invalid params", async () => {
    const res = await GET(makeReq(), { params: makeParams("bad owner", "repo") });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_params");
  });

  it("returns dependency list for a happy path", async () => {
    vi.mocked(fetchRepoDependencies).mockResolvedValue(makeResult({
      dependencies: [makeDep("react", "npm", "18.2.0"), makeDep("typescript", "npm", "5.0.0")],
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disabled).toBe(false);
    expect(body.dependencies).toHaveLength(2);
    expect(body.dependencies[0]).toEqual({ name: "react", ecosystem: "npm", version: "18.2.0" });
    expect(body.shownCount).toBe(2);
    expect(body.totalCount).toBe(2);
    expect(body.truncated).toBe(false);
  });

  it("sets truncated:true when totalCount exceeds 100", async () => {
    const deps = Array.from({ length: 150 }, (_, i) => makeDep(`pkg${i}`));
    vi.mocked(fetchRepoDependencies).mockResolvedValue(makeResult({
      dependencies: deps,
      totalCount: 150,
    }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.shownCount).toBe(100);
    expect(body.totalCount).toBe(150);
  });

  it("returns disabled:true when dependency graph is not enabled", async () => {
    vi.mocked(fetchRepoDependencies).mockResolvedValue(makeResult({ disabled: true, dependencies: [] }));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disabled).toBe(true);
    expect(body.dependencies).toHaveLength(0);
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(fetchRepoDependencies).mockRejectedValue(new GitHubTokenInvalidError());
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(401);
  });

  it("returns 429 with resetAt when rate limited", async () => {
    const resetAt = Date.now() + 60_000;
    vi.mocked(fetchRepoDependencies).mockRejectedValue(new GitHubRateLimitError(resetAt));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.resetAt).toBe(resetAt);
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(fetchRepoDependencies).mockRejectedValue(new Error("Network failure"));
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.status).toBe(500);
  });

  it("sets long-lived Cache-Control header", async () => {
    vi.mocked(fetchRepoDependencies).mockResolvedValue(makeResult());
    const res = await GET(makeReq(), { params: makeParams() });
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });
});
