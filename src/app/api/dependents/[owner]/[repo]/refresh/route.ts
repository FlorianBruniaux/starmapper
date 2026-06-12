// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// POST /api/dependents/[owner]/[repo]/refresh
// Fetches dependents from ecosyste.ms, compresses, and stores in dependents_cache.
// Rate limited to once per hour per repo via fetchedAt timestamp.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";
import { compressToGzBase64 } from "@/lib/compression";
import { fetchDependents } from "@/lib/dependents";

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const POST = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  if (process.env.NEXT_PUBLIC_DEPENDENTS_ENABLED !== "true") {
    return jsonError("feature_disabled", 404);
  }

  const { owner: rawOwner, repo: rawRepo } = await params;
  if (!OWNER_REPO_RE.test(rawOwner) || !OWNER_REPO_RE.test(rawRepo)) {
    return jsonError("invalid_params", 400);
  }
  const key = normalizeOwnerRepo(rawOwner, rawRepo);

  try {
    // Cooldown check — avoid re-fetching within 1 hour, unless the cache is empty/corrupted
    const existing = await prisma.dependentsCache.findUnique({
      where: { owner_repo: key },
      select: { fetchedAt: true, dataGz: true },
    });
    if (existing?.fetchedAt && Date.now() - existing.fetchedAt.getTime() < COOLDOWN_MS) {
      // Bypass cooldown if the cache is corrupted (has data string but likely empty dependents)
      const isCacheCorrupt = existing.dataGz.length < 1000;
      if (!isCacheCorrupt) return jsonError("rate_limited", 429);
    }

    const result = await fetchDependents(key.owner, key.repo);

    // dataGz stores [result] (array-wrapped) to match decompressGzBase64 convention
    const dataGz = compressToGzBase64([result]);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.dependentsCache.upsert({
      where: { owner_repo: key },
      create: {
        ...key,
        dataGz,
        totalCount: result.totalCount,
        fetchedAt: now,
        expiresAt,
      },
      update: {
        dataGz,
        totalCount: result.totalCount,
        fetchedAt: now,
        expiresAt,
      },
    });

    return NextResponse.json({
      ok: true,
      totalCount: result.totalCount,
      dependentsFound: result.dependents.length,
      packages: result.packages.map((p) => p.name),
      truncated: result.truncated,
    });
  } catch (err) {
    logError("api/dependents refresh POST", err);
    return jsonError("internal", 500);
  }
};
