// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPat, normalizeLogin, getRedis } from "@/lib/github-auth";
import { getOrCreateGitHubUserMinimal } from "@/lib/user-cache";
import { jsonError, logError } from "@/lib/api-helpers";
import { defineRoute } from "@/lib/define-route";
import { newsBodySchema } from "@/schemas/news";

export type NewsItem = {
  id: number;
  authorLogin: string;
  body: string;
  url: string | null;
  publishedAt: string;
};

export const POST = async (req: NextRequest) => {
  const pat = req.headers.get("x-gh-token");
  if (!pat) return jsonError("pat_required", 401);

  const authorLogin = await verifyPat(pat);
  if (!authorLogin) return jsonError("pat_invalid", 401);

  return defineRoute(newsBodySchema, async (_req, parsed) => {
    const { body: text, url } = parsed;

    // Redis lock — prevents TOCTOU: two concurrent requests with the same PAT passing
    // the cooldown check before either create completes.
    const redis = getRedis();
    const lockKey = `lock:news:${authorLogin}`;
    let lockAcquired = false;
    if (redis) {
      try {
        const acquired = await redis.set(lockKey, "1", { nx: true, ex: 60 });
        lockAcquired = acquired !== null;
      } catch { /* Redis unavailable — proceed without lock (TOCTOU risk accepted) */ }
      if (!lockAcquired) return NextResponse.json({ error: "cooldown_active", retryAfterSec: 5 }, { status: 429 });
    }

    try {
      // Sliding 24h cooldown — intentionally includes deleted posts so that
      // publish → delete → re-publish cannot be used to bypass the cooldown.
      const recent = await prisma.news.findFirst({
        where: {
          authorLogin,
          publishedAt: { gt: new Date(Date.now() - 86_400_000) },
        },
        select: { publishedAt: true },
      });

      if (recent) {
        const retryAfterMs = 86_400_000 - (Date.now() - recent.publishedAt.getTime());
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        return NextResponse.json(
          { error: "cooldown_active", retryAfterSec },
          { status: 429 },
        );
      }

      await getOrCreateGitHubUserMinimal(normalizeLogin(authorLogin));

      const news = await prisma.news.create({
        data: {
          authorLogin,
          body: text.trim(),
          url: typeof url === "string" ? url : null,
        },
      });

      return NextResponse.json({
        ok: true,
        news: {
          id: news.id,
          authorLogin: news.authorLogin,
          body: news.body,
          url: news.url,
          publishedAt: news.publishedAt.toISOString(),
        } satisfies NewsItem,
      });
    } catch (err) {
      logError("api/news POST", err);
      return jsonError("internal", 500);
    } finally {
      if (lockAcquired && redis) redis.del(lockKey).catch(() => {});
    }
  })(req);
};
