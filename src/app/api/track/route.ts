// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { prisma } from "@/lib/db";
import { defineRoute } from "@/lib/define-route";
import { getIP } from "@/lib/api-helpers";
import { trackSchema } from "@/schemas/track";

// Lazy init — Redis.fromEnv() throws at module load if UPSTASH_REDIS_REST_URL is unset.
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

export const POST = defineRoute(trackSchema, async (req, body) => {
  const limiter = getTrackLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(getIP(req));
      if (!success) return NextResponse.json({ ok: true });
    } catch {
      // Redis unavailable — fail open
    }
  }

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
