// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchProfile } from "@/lib/profile-query";
import { jsonError, logError } from "@/lib/api-helpers";

// Re-exported so existing consumers (profile/[login]/page.tsx, page.client.tsx) keep
// importing these from here. Same pattern as MappedRepo in api/repos/route.ts.
export type { ProfileRepo, ProfileResponse } from "@/lib/profile-query";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  try {
    const result = await fetchProfile(login);
    if (!result.ok) return jsonError(result.error, result.status);
    return NextResponse.json(result.profile, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    logError("profile", err);
    return jsonError("internal", 500);
  }
};
