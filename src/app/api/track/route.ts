// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { defineRoute } from "@/lib/define-route";
import { trackSchema } from "@/schemas/track";

// Rate limiting for this route lives in src/proxy.ts (rl:track, POST_ROUTES) — a
// second per-IP limiter here would double the Upstash command cost for zero benefit.
export const POST = defineRoute(trackSchema, async (_req, body) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  try {
    await prisma.pageView.upsert({
      where: { type_slug_date: { type: body.type, slug: body.slug, date } },
      create: { type: body.type, slug: body.slug, date, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch {
    // Analytics never fails the caller.
  }

  return NextResponse.json({ ok: true });
});
