import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type ProfileResponse = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  publicRepos: number;
  trackedRepos: { owner: string; repo: string; starredAt: string | null }[];
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) => {
  const { login } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(login)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  try {
    const [user, starEvents] = await Promise.all([
      prisma.gitHubUser.findUnique({
        where: { login },
        select: { login: true, name: true, company: true, location: true, followers: true, publicRepos: true },
      }),
      prisma.starEvent.findMany({
        where: { login },
        select: { owner: true, repo: true, starredAt: true },
        orderBy: { starredAt: "desc" },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const profile: ProfileResponse = {
      ...user,
      trackedRepos: starEvents.map((e) => ({
        owner: e.owner,
        repo: e.repo,
        starredAt: e.starredAt?.toISOString() ?? null,
      })),
    };

    return NextResponse.json(profile, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[profile] Error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
