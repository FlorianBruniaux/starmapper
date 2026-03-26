import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { prisma } from "@/lib/db";

const MAX_CACHEABLE_STARS = 100_000;

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, points, unmapped, totalCount } = body;

    const nameRe = /^[a-zA-Z0-9._-]{1,100}$/;
    if (
      typeof owner !== "string" || !nameRe.test(owner) ||
      typeof repo !== "string" || !nameRe.test(repo) ||
      !Array.isArray(points) ||
      !Array.isArray(unmapped) ||
      typeof totalCount !== "number" || totalCount < 0
    ) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    // Validate actual array sizes, not the client-declared totalCount
    if (points.length + unmapped.length > MAX_CACHEABLE_STARS) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }

    const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

    // Strip bio + avatarUrl (bio: fetched on-demand, avatarUrl: reconstructed from login on read)
    type RawPoint = { bio?: unknown; avatarUrl?: unknown; [k: string]: unknown };
    const slim = (points as RawPoint[]).map(({ bio: _bio, avatarUrl: _av, ...rest }) => rest);

    // Gzip + base64 encode — no schema change needed, stored as JSON string
    // Reduces storage ~3x vs PostgreSQL TOAST pglz alone
    const pointsGz = gzipSync(JSON.stringify(slim)).toString("base64");
    const unmappedGz = gzipSync(JSON.stringify(unmapped)).toString("base64");

    await prisma.stargazerCache.upsert({
      where: { owner_repo: key },
      create: { ...key, points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: new Date() },
      update: { points: pointsGz, unmapped: unmappedGz, totalCount, scannedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
