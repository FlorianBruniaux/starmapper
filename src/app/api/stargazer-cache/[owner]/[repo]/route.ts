import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

  try {
    const cached = await prisma.stargazerCache.findUnique({ where: { owner_repo: key } });

    if (cached) {
      return NextResponse.json({
        points: cached.points,
        unmapped: cached.unmapped,
        totalCount: cached.totalCount,
        scannedAt: cached.scannedAt.toISOString(),
      });
    }

    // No stargazer cache — check badge_cache for last scan metadata
    const badge = await prisma.badgeCache.findUnique({ where: { owner_repo: key } });
    if (badge) {
      return NextResponse.json({ lastScan: badge.updatedAt.toISOString() }, { status: 206 });
    }

    return NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
