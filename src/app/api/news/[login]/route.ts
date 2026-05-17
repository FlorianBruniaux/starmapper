// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidLogin, normalizeLogin } from "@/lib/github-auth";
import { jsonError, logError } from "@/lib/api-helpers";
import type { NewsItem } from "@/app/api/news/route";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login: rawLogin } = await params;
  if (!isValidLogin(rawLogin)) return jsonError("invalid_login", 400);
  const login = normalizeLogin(rawLogin);

  try {
    const rows = await prisma.news.findMany({
      where: { authorLogin: login, deletedAt: null },
      orderBy: { publishedAt: "desc" },
      take: 20,
      select: { id: true, authorLogin: true, body: true, url: true, publishedAt: true },
    });

    const items: NewsItem[] = rows.map((n) => ({
      id: n.id,
      authorLogin: n.authorLogin,
      body: n.body,
      url: n.url,
      publishedAt: n.publishedAt.toISOString(),
    }));

    return NextResponse.json({ items, hasMore: rows.length === 20 }, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    logError("api/news/[login] GET", err);
    return jsonError("internal", 500);
  }
};
