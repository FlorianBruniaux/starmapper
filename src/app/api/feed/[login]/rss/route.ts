// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidLogin, normalizeLogin } from "@/lib/github-auth";
import { buildRss20 } from "@/lib/feed-builders";
import { jsonError, logError } from "@/lib/api-helpers";

export const revalidate = 3600;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login: rawLogin } = await params;
  if (!isValidLogin(rawLogin)) return jsonError("invalid_login", 400);
  const login = normalizeLogin(rawLogin);

  try {
    const [rows, author] = await Promise.all([
      prisma.news.findMany({
        where: { authorLogin: login, deletedAt: null },
        orderBy: { publishedAt: "desc" },
        take: 20,
        select: { id: true, body: true, url: true, publishedAt: true },
      }),
      prisma.gitHubUser.findUnique({
        where: { login },
        select: { login: true, name: true },
      }),
    ]);

    if (!author) return jsonError("not_found", 404);

    const lastModified = rows[0]?.publishedAt ?? new Date(0);
    const ifModifiedSince = req.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && clientDate >= lastModified) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";
    const feedUrl = `${appUrl}/api/feed/${login}/rss`;

    const xml = buildRss20(
      rows.map((r) => ({ ...r, authorLogin: login })),
      author,
      feedUrl,
      appUrl,
    );

    // Track subscriber hit directly (no HTTP self-call)
    void prisma.pageView
      .upsert({
        where: { type_slug_date: { type: "feed_rss", slug: login, date: (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; })() } },
        create: { type: "feed_rss", slug: login, date: (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; })(), count: 1 },
        update: { count: { increment: 1 } },
      })
      .catch(() => {});

    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=600",
        "Last-Modified": lastModified.toUTCString(),
      },
    });
  } catch (err) {
    logError("api/feed/[login]/rss GET", err);
    return jsonError("internal", 500);
  }
};
