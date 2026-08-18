// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { cacheLife, cacheTag } from "next/cache";
import ExplorePageClient from "./page.client";
import { fetchExploreSummary } from "@/lib/explore-query";
import { logError } from "@/lib/api-helpers";
import type { ExploreSummary } from "@/app/api/explore/route";

const fetchSummary = async (): Promise<ExploreSummary | null> => {
  "use cache";
  // Was tagged "explore-summary", which nothing ever invalidated. refresh-grid-mv fires
  // revalidateTag("explore-mvs") after rebuilding the very views this reads, so use that
  // tag and the cron now actually refreshes this page.
  cacheTag("explore-mvs");
  cacheLife({ stale: 86400, revalidate: 3600, expire: 86400 });
  try {
    // Direct call rather than fetch(APP_URL + "/api/explore"): the handler only wraps
    // fetchExploreSummary, and the round trip cost an extra edge request plus an extra
    // function invocation on every miss.
    return await fetchExploreSummary();
  } catch (err) {
    logError("explore page summary", err);
    return null;
  }
};

export default async function ExplorePage() {
  const initialSummary = await fetchSummary();
  return <ExplorePageClient initialSummary={initialSummary} />;
}
