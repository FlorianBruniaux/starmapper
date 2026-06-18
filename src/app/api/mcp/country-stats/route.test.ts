// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/devs-query", () => ({
  fetchTopCountries: vi.fn(),
}));

import { fetchTopCountries } from "@/lib/devs-query";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mcp/country-stats", () => {
  it("returns country list with totals", async () => {
    vi.mocked(fetchTopCountries).mockResolvedValue({
      countries: [
        { slug: "united-states", name: "United States", count: 5000 },
        { slug: "china", name: "China", count: 3000 },
        { slug: "india", name: "India", count: 2000 },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countries).toHaveLength(3);
    expect(body.countries[0]).toEqual({ name: "United States", count: 5000, slug: "united-states" });
    expect(body.totalCountries).toBe(3);
    expect(body.totalStargazers).toBe(10000);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("returns empty list when MV has no data", async () => {
    vi.mocked(fetchTopCountries).mockResolvedValue({ countries: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countries).toHaveLength(0);
    expect(body.totalCountries).toBe(0);
    expect(body.totalStargazers).toBe(0);
  });

  it("returns 500 when fetchTopCountries throws", async () => {
    vi.mocked(fetchTopCountries).mockRejectedValue(new Error("MV missing"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal");
  });

  it("sets long-lived Cache-Control header", async () => {
    vi.mocked(fetchTopCountries).mockResolvedValue({ countries: [] });
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });
});
