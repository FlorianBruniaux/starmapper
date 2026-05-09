// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockCreateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    starEvent: { createMany: (...args: unknown[]) => mockCreateMany(...args) },
    gitHubUser: { upsert: vi.fn().mockResolvedValue(undefined) },
  },
}));

const mockCheckDbHealth = vi.fn();
vi.mock("@/lib/db-health", () => ({
  checkDbHealth: (...args: unknown[]) => mockCheckDbHealth(...args),
  DB_CRITICAL_PCT: 95,
  DB_WARN_PCT: 80,
}));

const mockLogError = vi.fn();
vi.mock("@/lib/api-helpers", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { bulkUpsertUsers, bulkUpsertStarEvents } from "@/lib/user-cache";
import type { UserWritePayload } from "@/lib/user-cache";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeUser = (overrides: Partial<UserWritePayload> = {}): UserWritePayload => ({
  login: "octocat",
  name: "The Octocat",
  company: null,
  location: "San Francisco, CA",
  followers: 10,
  following: 2,
  publicRepos: 5,
  accountCreatedAt: "2011-01-25T18:44:36Z",
  lat: 37.77,
  lng: -122.42,
  linkedinUrl: null,
  countryNormalized: "United States",
  cityNormalized: "San Francisco",
  ...overrides,
});

const healthOk = { ok: true as const, usagePct: 10 };
const healthFull = { ok: true as const, usagePct: 96 };
const healthDown = { ok: false as const };

// ─── bulkUpsertUsers ─────────────────────────────────────────────────────────

describe("bulkUpsertUsers()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRaw.mockResolvedValue(undefined);
    mockCheckDbHealth.mockResolvedValue(healthOk);
  });

  it("returns true immediately for empty array without DB call", async () => {
    const result = await bulkUpsertUsers([]);
    expect(result).toBe(true);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("returns false when DB health check reports ok=false", async () => {
    mockCheckDbHealth.mockResolvedValue(healthDown);
    const result = await bulkUpsertUsers([makeUser()]);
    expect(result).toBe(false);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("returns false and logs warning when usagePct >= DB_CRITICAL_PCT", async () => {
    mockCheckDbHealth.mockResolvedValue(healthFull);
    const result = await bulkUpsertUsers([makeUser()]);
    expect(result).toBe(false);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("calls prisma.$queryRaw for non-empty array when health is ok", async () => {
    const result = await bulkUpsertUsers([makeUser()]);
    expect(result).toBe(true);
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it("uses the pre-fetched health value when passed as argument", async () => {
    await bulkUpsertUsers([makeUser()], healthOk);
    expect(mockCheckDbHealth).not.toHaveBeenCalled();
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it("returns false and calls logError when prisma throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB timeout"));
    const result = await bulkUpsertUsers([makeUser()]);
    expect(result).toBe(false);
    expect(mockLogError).toHaveBeenCalledOnce();
  });
});

// ─── bulkUpsertStarEvents ────────────────────────────────────────────────────

describe("bulkUpsertStarEvents()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMany.mockResolvedValue({ count: 1 });
    mockCheckDbHealth.mockResolvedValue(healthOk);
  });

  it("returns without DB call for empty array", async () => {
    await bulkUpsertStarEvents([]);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("skips DB call when health check fails (ok=false)", async () => {
    mockCheckDbHealth.mockResolvedValue(healthDown);
    await bulkUpsertStarEvents([{ login: "a", owner: "b", repo: "c", starredAt: "2024-01-01T00:00:00Z" }]);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("skips DB call when usagePct >= DB_CRITICAL_PCT", async () => {
    mockCheckDbHealth.mockResolvedValue(healthFull);
    await bulkUpsertStarEvents([{ login: "a", owner: "b", repo: "c", starredAt: "2024-01-01T00:00:00Z" }]);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("calls createMany with skipDuplicates when health is ok", async () => {
    await bulkUpsertStarEvents([{ login: "a", owner: "b", repo: "c", starredAt: "2024-01-01T00:00:00Z" }]);
    expect(mockCreateMany).toHaveBeenCalledOnce();
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it("swallows prisma errors without rethrowing", async () => {
    mockCreateMany.mockRejectedValue(new Error("constraint violation"));
    await expect(
      bulkUpsertStarEvents([{ login: "a", owner: "b", repo: "c", starredAt: "2024-01-01T00:00:00Z" }]),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledOnce();
  });
});
