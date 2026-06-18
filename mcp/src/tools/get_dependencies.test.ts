// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client.js", () => ({
  fetchDependenciesMcp: vi.fn(),
}));

import { fetchDependenciesMcp } from "../client.js";
import { getDependencies } from "./get_dependencies.js";

const makeDep = (name: string, ecosystem = "npm", version = "1.0.0") => ({
  name,
  ecosystem,
  version,
});

const baseData = {
  dependencies: [makeDep("react", "npm", "18.2.0"), makeDep("typescript", "npm", "5.0.0")],
  totalCount: 2,
  shownCount: 2,
  truncated: false,
  disabled: false,
  fetchedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDependencies()", () => {
  it("renders dependency table with name, ecosystem, and version", async () => {
    vi.mocked(fetchDependenciesMcp).mockResolvedValue(baseData);
    const result = await getDependencies({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("react");
    expect(result).toContain("npm");
    expect(result).toContain("18.2.0");
    expect(result).toContain("typescript");
    expect(result).toContain("5.0.0");
  });

  it("returns disabled message when dependency graph is not enabled", async () => {
    vi.mocked(fetchDependenciesMcp).mockResolvedValue({ ...baseData, disabled: true, dependencies: [], totalCount: 0, shownCount: 0 });
    const result = await getDependencies({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("dependency graph is not enabled");
    expect(result).toContain("settings/security_analysis");
  });

  it("returns empty message when no dependencies found", async () => {
    vi.mocked(fetchDependenciesMcp).mockResolvedValue({ ...baseData, dependencies: [], totalCount: 0, shownCount: 0 });
    const result = await getDependencies({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("No dependencies found");
  });

  it("notes truncation when shownCount is less than totalCount", async () => {
    vi.mocked(fetchDependenciesMcp).mockResolvedValue({
      ...baseData,
      dependencies: Array.from({ length: 20 }, (_, i) => makeDep(`pkg${i}`)),
      totalCount: 150,
      shownCount: 100,
      truncated: true,
    });
    const result = await getDependencies({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("100");
    expect(result).toContain("150");
  });

  it("uses dash for missing ecosystem or version", async () => {
    vi.mocked(fetchDependenciesMcp).mockResolvedValue({
      ...baseData,
      dependencies: [{ name: "unknown-pkg", ecosystem: null, version: null }],
      totalCount: 1,
      shownCount: 1,
    });
    const result = await getDependencies({ owner: "vercel", repo: "next.js" });
    expect(result).toContain("| unknown-pkg | - | - |");
  });
});
