import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { prisma } from "@/lib/db";

const MAX_CACHEABLE_STARS = 100_000;

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, points, unmapped, pointsGz, unmappedGz, totalCount } = body;

    const nameRe = /^[a-zA-Z0-9._-]{1,100}$/;
    if (
      typeof owner !== "string" || !nameRe.test(owner) ||
      typeof repo !== "string" || !nameRe.test(repo) ||
      typeof totalCount !== "number" || totalCount < 0 || totalCount > MAX_CACHEABLE_STARS
    ) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

    let finalPointsGz: string;
    let finalUnmappedGz: string;

    if (typeof pointsGz === "string" && typeof unmappedGz === "string") {
      // New format: client compressed client-side to stay under Vercel's 4.5MB body limit
      finalPointsGz = pointsGz;
      finalUnmappedGz = unmappedGz;
    } else if (Array.isArray(points) && Array.isArray(unmapped)) {
      // Legacy format: raw arrays — compress on server
      if (points.length + unmapped.length > MAX_CACHEABLE_STARS) {
        return NextResponse.json({ error: "too_large" }, { status: 413 });
      }
      type RawPoint = { bio?: unknown; avatarUrl?: unknown; [k: string]: unknown };
      const slim = (points as RawPoint[]).map(({ bio: _bio, avatarUrl: _av, ...rest }) => rest);
      finalPointsGz = gzipSync(JSON.stringify(slim)).toString("base64");
      finalUnmappedGz = gzipSync(JSON.stringify(unmapped)).toString("base64");
    } else {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    await prisma.stargazerCache.upsert({
      where: { owner_repo: key },
      create: { ...key, points: finalPointsGz, unmapped: finalUnmappedGz, totalCount, scannedAt: new Date() },
      update: { points: finalPointsGz, unmapped: finalUnmappedGz, totalCount, scannedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
