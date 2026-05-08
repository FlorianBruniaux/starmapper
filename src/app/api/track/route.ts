// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_TYPES = new Set(["repo", "profile", "feed_rss"]);

const SLUG_RE: Record<string, RegExp> = {
  repo: /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/,
  profile: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
  feed_rss: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
};

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json() as { type?: unknown; slug?: unknown };
    const { type, slug } = body;

    if (typeof type !== "string" || !VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }
    if (typeof slug !== "string" || !SLUG_RE[type]?.test(slug)) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    await prisma.pageView.upsert({
      where: { type_slug_date: { type, slug, date } },
      create: { type, slug, date, count: 1 },
      update: { count: { increment: 1 } },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
};
