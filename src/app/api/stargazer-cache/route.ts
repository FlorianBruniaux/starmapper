// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { compressToGzBase64 } from "@/lib/compression";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { jsonError, logError } from "@/lib/api-helpers";
import { verifyToken, getSmSecrets, COOKIE_NAME } from "@/lib/api-token";
import { defineRoute } from "@/lib/define-route";
import { stargazerCacheEnvelopeSchema, MAX_CACHEABLE_STARS } from "@/schemas/stargazer-cache";
import { getRedis } from "@/lib/github-auth";

// Scalar star count — GitHub still serves this on GET /repos/{owner}/{repo} even though
// stargazer enumeration is restricted (see docs/ROADMAP.md). One cheap REST call, not the
// enumeration GitHub blocked, so this doesn't touch the GitHub-access pivot's constraints.
const fetchLiveStarCount = async (owner: string, repo: string): Promise<number | null> => {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { "User-Agent": "StarMapper/1.0" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
};

const resolvePatLogin = async (pat: string): Promise<string | null> => {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${pat}`, "User-Agent": "StarMapper" },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return typeof data.login === "string" ? data.login : null;
  } catch {
    return null;
  }
};

export const POST = defineRoute(stargazerCacheEnvelopeSchema, async (req, body) => {
  try {
    // Freshness check — ts type is validated by schema; window check requires Date.now()
    if (Math.abs(Date.now() - body.ts) > 5 * 60_000) {
      return jsonError("expired_request", 400);
    }

    // Session token check — only browsers that loaded a StarMapper page can write the cache.
    // The sm-token cookie is issued by the middleware on every page load (HttpOnly, SameSite=Strict).
    // Skip when SM_TOKEN_SECRET is not configured (local dev without env vars).
    const smSecrets = getSmSecrets();
    if (smSecrets.length > 0) {
      const smToken = req.cookies.get(COOKIE_NAME)?.value;
      if (!(await verifyToken(smToken, smSecrets))) {
        return jsonError("forbidden", 403);
      }
    }

    const key = { owner: body.owner, repo: body.repo };

    // Run plausibility check and DB health check in parallel (independent queries).
    const [existingBadge, health] = await Promise.all([
      prisma.badgeCache.findUnique({
        where: { owner_repo: key },
        select: { totalCount: true },
      }),
      checkDbHealth(),
    ]);

    // Plausibility check — new totalCount must not be <80% of a known-good count.
    // This catches fabricated/stripped-star submissions. The upper bound is intentionally absent:
    // fast-growing repos can legitimately 2x–5x between scans (e.g. a viral week).
    if (existingBadge && existingBadge.totalCount > 0) {
      const ratio = body.totalCount / existingBadge.totalCount;
      if (ratio < 0.8) {
        return jsonError("totalCount_mismatch", 400);
      }
    } else {
      // No BadgeCache row yet — this is the repo's first-ever write, so there was no
      // floor at all before this check existed: a first visitor could seed a poisoned
      // cache that every later visitor would see. One extra GitHub call closes that gap;
      // if the call itself fails (GitHub down, repo renamed), fail open rather than
      // block a legitimate first scan on an unrelated outage.
      const liveCount = await fetchLiveStarCount(body.owner, body.repo);
      if (liveCount !== null && liveCount > 0) {
        const ratio = body.totalCount / liveCount;
        if (ratio < 0.8) {
          return jsonError("totalCount_mismatch", 400);
        }
      }
    }

    let finalPointsGz: string;
    let finalUnmappedGz: string;

    if (typeof body.pointsGz === "string" && typeof body.unmappedGz === "string") {
      // New format: client compressed client-side to stay under Vercel's 4.5MB body limit
      // 30 MB base64 per field — supports up to ~500k stars
      if (body.pointsGz.length > 30_000_000 || body.unmappedGz.length > 30_000_000) {
        return jsonError("payload_too_large", 413);
      }
      finalPointsGz = body.pointsGz;
      finalUnmappedGz = body.unmappedGz;
    } else if (Array.isArray(body.points) && Array.isArray(body.unmapped)) {
      // Legacy format: raw arrays — compress on server
      if (body.points.length + body.unmapped.length > MAX_CACHEABLE_STARS) {
        return jsonError("too_large", 413);
      }
      type RawPoint = { bio?: unknown; avatarUrl?: unknown; [k: string]: unknown };
      const slim = (body.points as RawPoint[]).map(({ bio: _bio, avatarUrl: _av, ...rest }) => rest);
      finalPointsGz = compressToGzBase64(slim);
      finalUnmappedGz = compressToGzBase64(body.unmapped);
    } else {
      return jsonError("invalid_params", 400);
    }

    if (health.ok && health.usagePct >= DB_CRITICAL_PCT)
      return jsonError("storage_full", 507);

    const latestStarredAtDate =
      typeof body.latestStarredAt === "string" ? new Date(body.latestStarredAt) : null;

    const clientPat = req.headers.get("x-gh-token");
    const indexedBy = clientPat ? await resolvePatLogin(clientPat) : null;

    await prisma.stargazerCache.upsert({
      where: { owner_repo: key },
      create: {
        ...key,
        points: finalPointsGz,
        unmapped: finalUnmappedGz,
        totalCount: body.totalCount,
        scannedAt: new Date(),
        latestStarredAt: latestStarredAtDate,
        indexedBy,
      },
      update: {
        points: finalPointsGz,
        unmapped: finalUnmappedGz,
        totalCount: body.totalCount,
        scannedAt: new Date(),
        latestStarredAt: latestStarredAtDate,
        ...(indexedBy && { indexedBy }),
      },
    });

    // Invalidate the mcp:points Redis L1 cache — fire-and-forget
    const rKey = `mcp:points:v1:${body.owner}:${body.repo}`;
    getRedis()?.del(rKey).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("stargazer-cache POST", err);
    return jsonError("internal", 500);
  }
});
