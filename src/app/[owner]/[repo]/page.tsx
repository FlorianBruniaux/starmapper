// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { cacheLife, cacheTag } from "next/cache";
import MapPageClient from "./page.client";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const fetchRepoInfo = async (owner: string, repo: string): Promise<RepoInfo | null> => {
  "use cache";
  cacheTag(`repo-info-${owner}-${repo}`);
  cacheLife("minutes");
  try {
    const res = await fetch(
      `${APP_URL}/api/repo-info?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
    );
    if (!res.ok) return null;
    return res.json() as Promise<RepoInfo>;
  } catch {
    return null;
  }
};

export default async function MapPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const initialRepoInfo = await fetchRepoInfo(owner, repo);
  return <MapPageClient owner={owner} repo={repo} initialRepoInfo={initialRepoInfo} />;
}
