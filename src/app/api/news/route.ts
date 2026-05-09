// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPat, normalizeLogin, getRedis } from "@/lib/github-auth";
import { getOrCreateGitHubUserMinimal } from "@/lib/user-cache";
import { jsonError, logError } from "@/lib/api-helpers";

const BODY_MAX = 280;
const URL_RE = /^https:\/\/.+/;

// Block private/loopback/link-local hostnames to prevent SSRF via stored URLs.
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd|0\.0\.0\.0)/i;

const isPrivateUrl = (raw: string): boolean => {
  try {
    const { hostname } = new URL(raw);
    return PRIVATE_HOST_RE.test(hostname);
  } catch {
    return true;
  }
};

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_json", 400);
  }

  const { body: text, url } = body as { body?: unknown; url?: unknown };

  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonError("body_required", 400);
  }
  if (text.length > BODY_MAX) {
    return jsonError("body_too_long", 400);
  }
  if (url !== undefined && url !== null) {
    if (typeof url !== "string" || !URL_RE.test(url) || isPrivateUrl(url)) {
      return jsonError("url_invalid", 400);
    }
  }

  // Redis lock — prevents TOCTOU: two concurrent requests with the same PAT passing
  // the cooldown check before either create completes.
  const redis = getRedis();
  const lockKey = `lock:news:${authorLogin}`;
  let lockAcquired = false;
  if (redis) {
    try {
      const acquired = await redis.set(lockKey, "1", { nx: true, ex: 5 });
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
};
