// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocode } from "@/lib/geocoder";

export type RecalculateLocationResult =
  | { lat: number; lng: number }
  | { unmapped: true };

export const POST = async (req: Request): Promise<NextResponse<RecalculateLocationResult | { error: string }>> => {
  let login: string;
  try {
    const body = await req.json();
    login = typeof body.login === "string" ? body.login.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!login) return NextResponse.json({ error: "missing_login" }, { status: 400 });

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
};
