// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { OWNER_REPO_RE } from "@/lib/api-validation";

const schema = z.object({
  owner: z.string().regex(OWNER_REPO_RE).transform((s) => s.toLowerCase()),
  repo: z.string().regex(OWNER_REPO_RE).transform((s) => s.toLowerCase()),
  contributorsCount: z.number().int().nonnegative().max(100_000),
});

export const POST = async (req: Request) => {
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
