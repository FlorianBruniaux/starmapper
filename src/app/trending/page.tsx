// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { TrendingRepo, TrendingReposResponse } from "@/app/api/trending/repos/route";
import type { TrendingMapResponse } from "@/app/api/trending/map/route";
import type { StargazerPoint } from "@/app/api/chunk/route";
import { resolveBaseUrl } from "@/lib/base-url";
import { TrendingClient } from "./_components/trending-client";

export const revalidate = 300;

export default async function TrendingPage() {
  let repos: TrendingRepo[] = [];
  let total = 0;
  let mapPoints: StargazerPoint[] = [];
  let reposError: string | null = null;

  const base = resolveBaseUrl();

  const [reposRes, mapRes] = await Promise.allSettled([
    fetch(`${base}/api/trending/repos`, { next: { revalidate: 300 } }),
    fetch(`${base}/api/trending/map`, { next: { revalidate: 300 } }),
  ]);

  if (reposRes.status === "fulfilled") {
    const res = reposRes.value;
    if (res.ok) {
      const json = (await res.json()) as TrendingReposResponse;
      repos = json.repos;
      total = json.meta.total;
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      reposError = body.error === "trending_mv_empty"
        ? "Trending data is being initialized — check back soon."
        : "Could not load trending data.";
    }
  } else {
    reposError = "Could not load trending data.";
  }

  if (mapRes.status === "fulfilled" && mapRes.value.ok) {
    const json = (await mapRes.value.json()) as TrendingMapResponse;
    mapPoints = json.mapPoints;
  }

  return (
    <TrendingClient
      initialRepos={repos}
      initialTotal={total}
      initialMapPoints={mapPoints}
      reposError={reposError}
    />
  );
}
