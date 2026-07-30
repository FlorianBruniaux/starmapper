// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    roadmapVote: { count: (...args: unknown[]) => mockCount(...args) },
  },
}));

const mockSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

import { getTallies, notifyVote } from "@/lib/roadmap-vote";

describe("getTallies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all four keys at 0 when the table is empty", async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const result = await getTallies();
    expect(result).toEqual({ tallies: { A: 0, B: 0, C: 0, D: 0 }, totalVoters: 0 });
  });

  it("sums tallies above totalVoters for overlapping multi-select rows", async () => {
    mockQueryRaw.mockResolvedValue([
      { option: "A", count: 3n },
      { option: "C", count: 3n },
      { option: "D", count: 1n },
    ]);
    mockCount.mockResolvedValue(3);
    const result = await getTallies();
    expect(result.tallies).toEqual({ A: 3, B: 0, C: 3, D: 1 });
    expect(result.totalVoters).toBe(3);
    const sum = Object.values(result.tallies).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(result.totalVoters);
  });

  it("propagates a $queryRaw failure to the caller", async () => {
    mockQueryRaw.mockRejectedValue(new Error("db down"));
    mockCount.mockResolvedValue(0);
    await expect(getTallies()).rejects.toThrow("db down");
  });
});

describe("notifyVote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing and does not throw when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(notifyVote(["A"])).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends an email with the selected options when RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: null });
    await notifyVote(["A", "C"], "voter@example.com", "Ada");
    expect(mockSend).toHaveBeenCalledOnce();
    const payload = mockSend.mock.calls[0][0];
    expect(payload.subject).toContain("A+C");
    expect(payload.html).toContain("voter@example.com");
    expect(payload.html).toContain("Ada");
  });

  it("includes the optional free-text message, escaped, when provided", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: null });
    await notifyVote(["A"], "voter@example.com", "Ada", "Happy to chat <b>bold</b>");
    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).toContain("Happy to chat &lt;b&gt;bold&lt;/b&gt;");
  });

  it("omits the message block entirely when no message is given", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: null });
    await notifyVote(["A"], "voter@example.com", "Ada");
    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).not.toContain("Message:");
  });

  it("HTML-escapes a malicious name before interpolating into the email body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: null });
    await notifyVote(["A"], "voter@example.com", "<img src=x onerror=alert(1)>");
    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(payload.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("labels an anonymous vote as such when no contact is given", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: null });
    await notifyVote(["B"]);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).toContain("anonymous");
  });

  it("does not throw when Resend returns an error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockResolvedValue({ error: { message: "bad request" } });
    await expect(notifyVote(["A"])).resolves.toBeUndefined();
  });

  it("does not throw when Resend itself throws", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockSend.mockRejectedValue(new Error("network error"));
    await expect(notifyVote(["A"])).resolves.toBeUndefined();
  });
});
