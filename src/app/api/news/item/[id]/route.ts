// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPat } from "@/lib/github-auth";
import { jsonError, logError } from "@/lib/api-helpers";

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const pat = req.headers.get("x-gh-token");
  if (!pat) return jsonError("pat_required", 401);

  const authorLogin = await verifyPat(pat);
  if (!authorLogin) return jsonError("pat_invalid", 401);

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return jsonError("invalid_id", 400);

  try {
    const news = await prisma.news.findUnique({ where: { id }, select: { authorLogin: true, deletedAt: true } });
    if (!news) return jsonError("not_found", 404);
    if (news.deletedAt) return jsonError("already_deleted", 410);
    if (news.authorLogin !== authorLogin) return jsonError("forbidden", 403);

    await prisma.news.update({ where: { id }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/news/item/[id] DELETE", err);
    return jsonError("internal", 500);
  }
};
