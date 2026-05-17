// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
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
  const page    = Math.min(20, Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10)));
  const size    = Math.min(50, Math.max(1, parseInt(searchParams.get("size") ?? "30", 10)));
  const country = (searchParams.get("country") ?? "").substring(0, 100).replace(/[^\p{L}\p{N}\s'.,()-]/gu, "");

  type RawRow = { company: string; cnt: number };

  try {
    // company_stats_mv pre-aggregates 4.3M rows — reads in ~5ms instead of full scan.
    // Country filter bypasses MV (no country column) and hits the table directly.
    let raw: RawRow[];
    if (country) {
      const rows = await prisma.$queryRaw<{ company: string; cnt: bigint }[]>`
        SELECT company, COUNT(*) AS cnt
        FROM github_user
        WHERE company IS NOT NULL AND company <> ''
          AND "countryNormalized" ILIKE ${country}
        GROUP BY company
        ORDER BY cnt DESC
        LIMIT 1000
      `;
      raw = rows.map((r) => ({ company: r.company, cnt: Number(r.cnt) }));
    } else {
      // Fallback: empty (not a slow full scan — that would also timeout)
      const mvRows = await prisma.$queryRaw<{ company: string; cnt: bigint }[]>`
        SELECT company, cnt FROM company_stats_mv LIMIT 1000
      `.catch(() => []);
      raw = mvRows.map((r) => ({ company: r.company, cnt: Number(r.cnt) }));
    }

    // Normalize and aggregate in JS (handles @-prefix stripping, title-casing, dedup)
    // O(n) lookup via inverse map: lowercase → canonical name
    const companyCount = new Map<string, number>();
    const lowerToCanonical = new Map<string, string>();
    for (const { company, cnt } of raw) {
      if (!company) continue;
      const normalized = normalizeCompany(company);
      if (!normalized) continue;
      const keyLower = normalized.toLowerCase();
      const canonical = lowerToCanonical.get(keyLower) ?? normalized;
      lowerToCanonical.set(keyLower, canonical);
      companyCount.set(canonical, (companyCount.get(canonical) ?? 0) + cnt);
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
