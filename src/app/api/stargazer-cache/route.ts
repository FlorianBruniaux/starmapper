import { NextRequest, NextResponse } from "next/server";
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

    if (totalCount > MAX_CACHEABLE_STARS) {
      return NextResponse.json({ error: "too_large" }, { status: 413 });
    }

    const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

    // Strip bio from points to reduce storage (fetched on-demand via user-details)
    const slim = (points as { bio?: unknown }[]).map(({ bio: _bio, ...rest }) => rest);

    await prisma.stargazerCache.upsert({
      where: { owner_repo: key },
      create: { ...key, points: slim, unmapped, totalCount, scannedAt: new Date() },
      update: { points: slim, unmapped, totalCount, scannedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
