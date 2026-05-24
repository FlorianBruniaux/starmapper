// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { fetchLanguageList } from "@/lib/devs-query";
import { logError } from "@/lib/api-helpers";

// Re-exported for consumers that already import from this route.
export type { LanguageListItem, LanguageListData } from "@/lib/devs-query";

export const GET = async () => {
  try {
    const data = await fetchLanguageList();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    logError("devs/list", err);
    return NextResponse.json({ languages: [] });
  }
};
