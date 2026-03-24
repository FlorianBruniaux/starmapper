import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const POST = async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { owner, repo, mappedCount, countryCount, totalCount } = body;

    if (
      typeof owner !== "string" || !owner ||
      typeof repo !== "string" || !repo ||
      typeof mappedCount !== "number" ||
      typeof countryCount !== "number" ||
      typeof totalCount !== "number"
    ) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }

    await prisma.badgeCache.upsert({
      where: { owner_repo: { owner: owner.toLowerCase(), repo: repo.toLowerCase() } },
      create: {
        owner: owner.toLowerCase(),
        repo: repo.toLowerCase(),
        mappedCount,
        countryCount,
        totalCount,
      },
      update: { mappedCount, countryCount, totalCount },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
