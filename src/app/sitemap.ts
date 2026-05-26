// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { LANGUAGE_SLUG_MAP } from "@/lib/languages";

export const revalidate = 3600;

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Top repos from BadgeCache
  let repoEntries: MetadataRoute.Sitemap = [];
  // Top developer profiles
  let profileEntries: MetadataRoute.Sitemap = [];
  // Feed pages for users who have published news
  let feedEntries: MetadataRoute.Sitemap = [];

  try {
    const [repos, topUsers, newsAuthors] = await Promise.all([
      prisma.badgeCache.findMany({
        select: { owner: true, repo: true, updatedAt: true },
        orderBy: { totalCount: "desc" },
        take: 50,
      }),
      prisma.gitHubUser.findMany({
        select: { login: true, fetchedAt: true },
        orderBy: { followers: "desc" },
        take: 100,
      }),
      prisma.news.findMany({
        where: { deletedAt: null },
        select: { authorLogin: true, publishedAt: true },
        distinct: ["authorLogin"],
        orderBy: { publishedAt: "desc" },
        take: 50,
      }),
    ]);

    repoEntries = repos.map((r) => ({
      url: `${BASE}/${r.owner}/${r.repo}`,
      lastModified: r.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));

    profileEntries = topUsers.map((u) => ({
      url: `${BASE}/profile/${u.login}`,
      lastModified: u.fetchedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));

    feedEntries = newsAuthors.map((n) => ({
      url: `${BASE}/feed/${n.authorLogin}`,
      lastModified: n.publishedAt,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    }));
  } catch {
    // DB unavailable — skip dynamic entries
  }

  // All language dev map pages
  const languageEntries: MetadataRoute.Sitemap = Object.keys(LANGUAGE_SLUG_MAP).map((slug) => ({
    url: `${BASE}/devs/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/devs`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/devs/atlas`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/explore`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/trending`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/repos`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/feeds`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/sitemap`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/vs/star-history`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/faq`, lastModified: new Date("2026-04-24"), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/changelog`, lastModified: new Date("2026-04-24"), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: new Date("2026-04-06"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: new Date("2026-04-06"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/legal`, lastModified: new Date("2026-04-06"), changeFrequency: "yearly", priority: 0.3 },
    ...languageEntries,
    ...repoEntries,
    ...profileEntries,
    ...feedEntries,
  ];
}
