// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchExploreSummary } from "@/lib/explore-query";
import { jsonError, logError } from "@/lib/api-helpers";

// Re-exported so existing consumers (explore/page.tsx, explore/page.client.tsx) keep
// importing the type from here. Same pattern as MappedRepo in api/repos/route.ts.
export type { ExploreSummary } from "@/lib/explore-query";

export const GET = async () => {
  try {
    const data = await fetchExploreSummary();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
      },
    });
  } catch (err) {
    logError("explore", err);
    return jsonError("internal", 500);
  }
};
