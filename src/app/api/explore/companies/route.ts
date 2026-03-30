// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, logError } from "@/lib/api-helpers";

export type CompaniesResponse = {
  items: [string, number][];
  total: number;
  page: number;
  pageSize: number;
};

const NOISE_COMPANIES = new Set([
  "freelance", "freelancer", "self", "self-employed", "self employed",
  "independent", "none", "n/a", "na", "student", "home", "personal",
  "unemployed", "open source", "open-source", "retired", "hobbyist",
  "china", "japan", "india", "usa", "uk",
]);

const normalizeCompany = (raw: string): string | null => {
  const stripped = raw.trim().replace(/^@+/, "").trim();
  const key = stripped.toLowerCase();
  if (!stripped || stripped.length < 2 || NOISE_COMPANIES.has(key)) return null;
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const GET = async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
  const size    = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const country = searchParams.get("country") ?? "";

  try {
    const raw = await prisma.gitHubUser.groupBy({
      by: ["company"],
      _count: { company: true },
      where: {
        company: { not: null },
        ...(country ? { location: { contains: country, mode: "insensitive" as const } } : {}),
      },
      orderBy: { _count: { company: "desc" } },
      take: 1000,
    });

    // Normalize and aggregate in JS (handles @-prefix stripping, title-casing, dedup)
    const companyCount = new Map<string, number>();
    for (const { company, _count } of raw) {
      if (!company) continue;
      const normalized = normalizeCompany(company);
      if (!normalized) continue;
      const keyLower = normalized.toLowerCase();
      const existing = [...companyCount.entries()].find(([k]) => k.toLowerCase() === keyLower);
      if (existing) {
        companyCount.set(existing[0], existing[1] + _count.company);
      } else {
        companyCount.set(normalized, _count.company);
      }
    }

    const sorted: [string, number][] = [...companyCount.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.length;
    const items = sorted.slice((page - 1) * size, page * size);

    return NextResponse.json(
      { items, total, page, pageSize: size } satisfies CompaniesResponse,
      {
        headers: country
          ? { "Cache-Control": "no-store" }
          : { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
      },
    );
  } catch (err) {
    logError("explore/companies", err);
    return jsonError("internal", 500);
  }
};
