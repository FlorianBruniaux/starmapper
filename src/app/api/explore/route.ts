import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isCountry, normalizeCountry } from "@/lib/countries";

export type ExploreData = {
  totalUsers: number;
  totalTrackedRepos: number;
  totalStarEvents: number;
  totalCountries: number;
  topUsers: { login: string; name: string | null; followers: number; company: string | null; avatarUrl: string }[];
  powerStargazers: { login: string; name: string | null; followers: number; trackedRepos: number; avatarUrl: string }[];
  topCompanies: [string, number][];
  topCountries: [string, number][];
  topCities: [string, number][];
};

const NOISE_COMPANIES = new Set([
  "freelance", "freelancer", "self", "self-employed", "self employed",
  "independent", "none", "n/a", "na", "student", "home", "personal",
  "unemployed", "open source", "open-source", "retired", "hobbyist",
  "china", "japan", "india", "usa", "uk",
]);

const normalizeCompany = (raw: string): string | null => {
  const stripped = raw.trim().replace(/^@+/, "").trim();
  const key = stripped.toLowerCase();
  if (!stripped || stripped.length < 2 || NOISE_COMPANIES.has(key)) return null;
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
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

export const GET = async () => {
  try {
    const [totalUsers, totalStarEvents, totalTrackedRepos, topUsersRaw, crossRepoGroups, companiesRaw, locationGroups] = await Promise.all([
      prisma.gitHubUser.count(),
      prisma.starEvent.count(),
      prisma.badgeCache.count(),
      prisma.gitHubUser.findMany({
        orderBy: { followers: "desc" },
        take: 30,
        select: { login: true, name: true, followers: true, company: true },
      }),
      prisma.starEvent.groupBy({
        by: ["login"],
        _count: { login: true },
        orderBy: { _count: { login: "desc" } },
        take: 30,
      }),
      prisma.gitHubUser.groupBy({
        by: ["company"],
        _count: { company: true },
        where: { company: { not: null } },
        orderBy: { _count: { company: "desc" } },
        take: 500,
      }),
      prisma.gitHubUser.groupBy({
        by: ["location"],
        _count: { location: true },
        where: { location: { not: null } },
      }),
    ]);

    const topUsers = topUsersRaw.map((u) => ({
      ...u,
      avatarUrl: `https://github.com/${u.login}.png`,
    }));

    const powerCandidates = crossRepoGroups.filter((d) => (d._count.login ?? 0) > 1).slice(0, 20);
    const powerLogins = powerCandidates.map((d) => d.login);
    const powerUsersRaw = await prisma.gitHubUser.findMany({
      where: { login: { in: powerLogins } },
      select: { login: true, name: true, followers: true },
    });
    const powerUserMap = new Map(powerUsersRaw.map((u) => [u.login, u]));
    const powerStargazers = powerCandidates.map((d) => {
      const u = powerUserMap.get(d.login);
      return {
        login: d.login,
        name: u?.name ?? null,
        followers: u?.followers ?? 0,
        trackedRepos: d._count.login ?? 0,
        avatarUrl: `https://github.com/${d.login}.png`,
      };
    });

    const companyCount = new Map<string, number>();
    for (const { company, _count } of companiesRaw) {
      if (!company) continue;
      const normalized = normalizeCompany(company);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      const existing = [...companyCount.entries()].find(([k]) => k.toLowerCase() === key);
      if (existing) {
        companyCount.set(existing[0], existing[1] + _count.company);
      } else {
        companyCount.set(normalized, _count.company);
      }
    }
    const topCompanies: [string, number][] = [...companyCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

    const countryCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    for (const { location, _count } of locationGroups) {
      const n = _count.location;
      const { country, city } = parseLocation(location);
      if (country) countryCount.set(country, (countryCount.get(country) ?? 0) + n);
      if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + n);
    }
    const topCountries: [string, number][] = [...countryCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const topCities: [string, number][] = [...cityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

    const data: ExploreData = {
      totalUsers,
      totalTrackedRepos,
      totalStarEvents,
      totalCountries: countryCount.size,
      topUsers,
      powerStargazers,
      topCompanies,
      topCountries,
      topCities,
    };

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  } catch (err) {
    console.error("[explore] Error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
