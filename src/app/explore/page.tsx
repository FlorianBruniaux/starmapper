// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import ExplorePageClient from "./page.client";
import type { ExploreSummary } from "@/app/api/explore/route";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const fetchSummary = async (): Promise<ExploreSummary | null> => {
  try {
    const res = await fetch(`${APP_URL}/api/explore`, {
      next: { revalidate: 3600, tags: ["explore-summary"] },
    });
    if (!res.ok) return null;
    return res.json() as Promise<ExploreSummary>;
  } catch {
    return null;
  }
};

export default async function ExplorePage() {
  const initialSummary = await fetchSummary();
  return <ExplorePageClient initialSummary={initialSummary} />;
}
