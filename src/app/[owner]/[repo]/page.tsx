// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import MapPageClient from "./page.client";
import LoadingFallback from "./loading";
import { computeRepoStats } from "@/lib/repo-stats-query";
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
  // /api/repo-info already pins the upstream GitHub data for 300s (its own fetch carries
  // next: { revalidate: 300 }), so anything below that rewrote an identical value. The one
  // event that must show up immediately is the end of a scan, and badge-update already
  // fires revalidateTag("repo-info-…"). expire matters as much as revalidate here: the
  // "minutes" profile killed the entry after an hour, so a repo visited twice in a day
  // paid two full writes.
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 });
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
  // Aggregates move on three events only: a finished scan, the refresh-repo-stats cron
  // (02:00 and 14:00 UTC), and newly indexed star events. A 60s window matched none of
  // them. The scanning user does not depend on this cache at all, useScanController
  // re-fetches /api/stats directly when the scan ends; this entry only serves the first
  // render for later visitors, and badge-update now invalidates the tag for them.
  cacheLife({ stale: 300, revalidate: 600, expire: 86400 });
  try {
    // Direct call rather than fetch(APP_URL + "/api/stats/…"): the handler only wraps
    // computeRepoStats and maps its result to a status code. Both 400 and 404 collapse to
    // null here, exactly as the previous `!res.ok` check did.
    const result = await computeRepoStats(owner, repo);
    if (!result.ok) return null;
    // The route shortens its own Cache-Control to 30s when the Neon aggregation timed out,
    // but that header only governs the CDN. This SSR path is governed by cacheLife alone,
    // and cacheLife keeps the per-field minimum across calls, so this second call can only
    // shorten the entry, never extend it.
    //
    // The old value here was "seconds", which floors revalidate at 1: up to 86 400 writes
    // per day per repo under continuous traffic, unbounded. Aligning on the CDN's 30s/60s
    // instead of inventing a third value, with expire: 300 so a partial panel never
    // outlives 5 minutes.
    if (result.stats.isPartial) cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return result.stats;
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
