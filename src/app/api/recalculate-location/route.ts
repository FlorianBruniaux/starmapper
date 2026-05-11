// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocode } from "@/lib/geocoder";
import { verifyToken, COOKIE_NAME } from "@/lib/api-token";
import { defineRoute } from "@/lib/define-route";
import { recalculateLocationSchema } from "@/schemas/recalculate-location";

export type RecalculateLocationResult =
  | { lat: number; lng: number }
  | { unmapped: true };

export const POST = async (req: NextRequest) => {
  const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
  if (SM_SECRET) {
    const smToken = req.cookies.get(COOKIE_NAME)?.value;
    if (!(await verifyToken(smToken, SM_SECRET))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return defineRoute(
    recalculateLocationSchema,
    async (_req, body) => {
      const login = body.login; // already trimmed by schema transform

      const user = await prisma.gitHubUser.findUnique({
        where: { login },
        select: { location: true },
      });

      if (!user || !user.location) {
        return NextResponse.json({ error: "user_not_found" }, { status: 404 });
      }

      const locationKey = user.location.trim().toLowerCase();

      // Clear the bad cached result so geocode() re-resolves fresh
      try {
        await prisma.geoCache.deleteMany({ where: { key: locationKey } });
      } catch {
        // non-fatal — geocode() will still work, just may return the old cached result
      }

      const coords = await geocode(user.location);

      // Persist the recalculated result (or null) back to github_user
      try {
        await prisma.gitHubUser.update({
          where: { login },
          data: { lat: coords?.[0] ?? null, lng: coords?.[1] ?? null },
        });
      } catch {
        // non-fatal — caller gets the coords regardless
      }

      if (!coords) return NextResponse.json({ unmapped: true });
      return NextResponse.json({ lat: coords[0], lng: coords[1] });
    },
    { jsonErrorCode: "invalid_body" },
  )(req);
};
