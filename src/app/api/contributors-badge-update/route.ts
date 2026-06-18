// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { verifyToken, COOKIE_NAME } from "@/lib/api-token";
import { OWNER_REPO_RE } from "@/lib/api-validation";

const schema = z.object({
  owner: z.string().regex(OWNER_REPO_RE).transform((s) => s.toLowerCase()),
  repo: z.string().regex(OWNER_REPO_RE).transform((s) => s.toLowerCase()),
  contributorsCount: z.number().int().nonnegative().max(100_000),
});

export const POST = async (req: NextRequest) => {
  // SM token check — same pattern as badge-update and other write routes.
  // Blocks external requests; passes for any valid browser session.
  const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
  if (SM_SECRET) {
    const smToken = req.cookies.get(COOKIE_NAME)?.value;
    if (!(await verifyToken(smToken, SM_SECRET))) {
      return jsonError("forbidden", 403);
    }
  }

  try {
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return jsonError("invalid_params", 400);

    const { owner, repo, contributorsCount } = parsed.data;

    // updateMany is a no-op if no badge_cache row exists yet (repo not yet scanned by stargazers).
    await prisma.badgeCache.updateMany({
      where: { owner, repo },
      data: { contributorsCount },
    });

    revalidateTag("repos", { expire: 300 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contributors-badge-update] error", err);
    return jsonError("internal", 500);
  }
};
