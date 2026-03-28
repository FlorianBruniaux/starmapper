import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isCountry, normalizeCountry } from "@/lib/countries";

export type RepoStats = {
  totalStars: number;
  mappedCount: number;
  mappingRate: number;
  avgFollowers: number;
  countryCount: number;
  topCountries: [string, number][];
  topCities: [string, number][];
  topCompanies: [string, number][];
  topUsers: { login: string; name: string | null; followers: number; location: string | null; avatarUrl: string; company: string | null }[];
  powerStargazers: { login: string; name: string | null; followers: number; trackedRepos: number; avatarUrl: string }[];
  botCount: number;
  enrichedUserCount: number;
};

const parseLocation = (location: string | null): { country: string | null; city: string | null } => {
  if (!location) return { country: null, city: null };
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { country: null, city: null };

  const lastSegment = parts[parts.length - 1];
  const country = isCountry(lastSegment) ? normalizeCountry(lastSegment) : null;
  const city = parts.length > 1 ? parts[0] : (country ? null : parts[0]);

  return { country, city };
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  const nameRe = /^[a-zA-Z0-9._-]{1,100}$/;
  if (!nameRe.test(owner) || !nameRe.test(repo)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const key = { owner: owner.toLowerCase(), repo: repo.toLowerCase() };

  try {
    const events = await prisma.starEvent.findMany({
      where: key,
      take: 10_000, // cap in-memory aggregation; repos > 10k stars get approximate stats
      select: {
        user: {
          select: {
            login: true, name: true, location: true, company: true, followers: true,
            following: true, publicRepos: true, dataVersion: true, lat: true, lng: true,
          },
        },
      },
    });

    if (!events.length) {
      return NextResponse.json({ error: "no_data" }, { status: 404 });
    }

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    const companyCount = new Map<string, number>();
    let followerSum = 0;
    let mappedCount = 0;
    let botCount = 0;
    let enrichedUserCount = 0;

    for (const { user: u } of events) {
      if (u.lat !== null && u.lng !== null) mappedCount++;

      const { country, city } = parseLocation(u.location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + 1);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
      if (u.company) companyCount.set(u.company, (companyCount.get(u.company) ?? 0) + 1);
      followerSum += u.followers;

      if (u.dataVersion >= 1) {
        enrichedUserCount++;
        if (u.followers < 5 && u.following < 5 && u.publicRepos < 2) botCount++;
      }
    }

    const total = events.length;
    const topUsers = events
      .map(({ user: u }) => ({
        login: u.login,
        name: u.name,
        followers: u.followers,
        location: u.location,
        avatarUrl: `https://github.com/${u.login}.png`,
        company: u.company,
      }))
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 20);

    // Power stargazers: users who starred multiple repos tracked by StarMapper
    const repoLogins = events.map((e) => e.user.login);
    const crossRepoGroups = await prisma.starEvent.groupBy({
      by: ["login"],
      where: { login: { in: repoLogins } },
      _count: { login: true },
      orderBy: { _count: { login: "desc" } },
      take: 50,
    });
    const userMap = new Map(events.map((e) => [e.user.login, e.user]));
    const powerStargazers = crossRepoGroups
      .filter((d) => (d._count.login ?? 0) > 1)
      .slice(0, 20)
      .map((d) => {
        const u = userMap.get(d.login);
        return {
          login: d.login,
          name: u?.name ?? null,
          followers: u?.followers ?? 0,
          trackedRepos: d._count.login ?? 0,
          avatarUrl: `https://github.com/${d.login}.png`,
        };
      });

    const stats: RepoStats = {
      totalStars: total,
      mappedCount,
      mappingRate: total > 0 ? Math.round((mappedCount / total) * 100) : 0,
      avgFollowers: total > 0 ? Math.round(followerSum / total) : 0,
      countryCount: countryCount.size,
      topCountries: [...countryCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCities: [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topCompanies: [...companyCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
      topUsers,
      powerStargazers,
      botCount,
      enrichedUserCount,
    };

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[stats] Error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
