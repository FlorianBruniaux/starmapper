// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "@/lib/db";

const VALID_TYPES = new Set(["repo", "profile", "feed_rss"]);

const SLUG_RE: Record<string, RegExp> = {
  repo: /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/,
  profile: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
  feed_rss: /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
};

// ---------------------------------------------------------------------------
// Rate limiter — 60 req/min per IP (lazy init to avoid module-level failures)
// ---------------------------------------------------------------------------

let _trackLimiter: Ratelimit | null = null;

const getTrackLimiter = (): Ratelimit | null => {
  if (_trackLimiter) return _trackLimiter;
  try {
    _trackLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "rl:track",
    });
    return _trackLimiter;
  } catch {
    return null;
  }
};

const getIP = (req: NextRequest): string =>
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

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

    // Rate limit — silently return ok when exceeded (analytics endpoint, not an error state)
    const limiter = getTrackLimiter();
    if (limiter) {
      try {
        const { success } = await limiter.limit(getIP(req));
        if (!success) return NextResponse.json({ ok: true });
      } catch {
        // Redis unavailable — fail open, never block analytics writes
      }
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
