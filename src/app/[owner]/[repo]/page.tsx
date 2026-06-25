// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import MapPageClient from "./page.client";
import LoadingFallback from "./loading";
import type { RepoStats } from "@/app/api/stats/[owner]/[repo]/route";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  language: string | null;
  avatar: string | null;
  forksCount: number;
  watchersCount: number;
  contributorsCount: number | null;
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

const fetchStats = async (owner: string, repo: string): Promise<RepoStats | null> => {
  "use cache";
  cacheTag(`repo-stats-${owner}-${repo}`);
  cacheLife("minutes");
  try {
    const res = await fetch(
      `${APP_URL}/api/stats/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
    if (!res.ok) return null;
    return res.json() as Promise<RepoStats>;
  } catch {
    return null;
  }
};

const MapContent = async ({ params }: { params: Promise<{ owner: string; repo: string }> }) => {
  const { owner, repo } = await params;
  // Fire both fetches in parallel — stats can be a slow DB query on large repos,
  // starting it server-side avoids the client-side waterfall entirely.
  const [initialRepoInfo, initialStats] = await Promise.all([
    fetchRepoInfo(owner, repo),
    fetchStats(owner, repo),
  ]);
  return (
    <MapPageClient
      owner={owner}
      repo={repo}
      initialRepoInfo={initialRepoInfo}
      initialStats={initialStats}
    />
  );
};

export default function MapPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <MapContent params={params} />
    </Suspense>
  );
}
