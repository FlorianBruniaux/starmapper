// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchAtlasData } from "@/lib/devs-query";
import { logError } from "@/lib/api-helpers";

// Re-exported for consumers that already import from this route.
export type { AtlasCountry, AtlasDominantData } from "@/lib/devs-query";

const EMPTY = {
  mode: "dominant" as const,
  countries: [],
  meta: { minDevsThreshold: 10, generatedAt: new Date().toISOString() },
};

export const GET = async () => {
  try {
    const data = await fetchAtlasData();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    logError("devs/atlas", err);
    // Graceful degradation: MV missing or DB down → empty atlas
    return NextResponse.json(EMPTY);
  }
};
