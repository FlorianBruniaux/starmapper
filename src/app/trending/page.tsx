// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { TrendingRepo } from "@/lib/trending-query";
import type { StargazerPoint } from "@/app/api/chunk/route";
import { fetchTrendingRepos, fetchTrendingMap } from "@/lib/trending-query";
import { TrendingClient } from "./_components/trending-client";

export default async function TrendingPage() {
  let repos: TrendingRepo[] = [];
  let total = 0;
  let mapPoints: StargazerPoint[] = [];
  let reposError: string | null = null;

  const [reposResult, mapResult] = await Promise.allSettled([
    fetchTrendingRepos(),
    fetchTrendingMap(),
  ]);

  if (reposResult.status === "fulfilled") {
    if (reposResult.value === null) {
      reposError = "Trending data is being initialized — check back soon.";
    } else {
      repos = reposResult.value.repos;
      total = reposResult.value.meta.total;
    }
  } else {
    reposError = "Could not load trending data.";
  }

  if (mapResult.status === "fulfilled") {
    mapPoints = mapResult.value;
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
