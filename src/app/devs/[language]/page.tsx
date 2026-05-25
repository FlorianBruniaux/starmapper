// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/db";
import { slugToLanguage, displayLanguage } from "@/lib/languages";
import DevsLanguageClient from "@/app/devs/[language]/page.client";

type Props = {
  params: Promise<{ language: string }>;
};

const getLanguageDevCount = async (canonicalName: string): Promise<number> => {
  "use cache";
  cacheTag("explore-mvs");
  cacheLife("hours");
  try {
    return await prisma.gitHubUser.count({
      where: { languages: { has: canonicalName } },
    });
  } catch {
    return 0;
  }
};

const DevsLanguagePageContent = async ({ params }: Props) => {
  const { language: slug } = await params;
  const decodedSlug = decodeURIComponent(slug);
  const canonicalName = slugToLanguage(decodedSlug) ?? decodedSlug;
  const displayName = displayLanguage(canonicalName);

  const devCount = await getLanguageDevCount(canonicalName);

  const countLabel = devCount > 0
    ? `${devCount.toLocaleString()} ${displayName} developers mapped`
    : `${displayName} developers worldwide`;

  return (
    <>
      {/* SSR block — visible to crawlers, hidden from sighted users */}
      <div className="sr-only">
        <h1>{displayName} developers world map</h1>
        <p>
          {countLabel} on GitHub. Explore where {displayName} developers are located
          by country and city, based on self-reported GitHub profile locations.
        </p>
        <p>
          See the{" "}
          <Link href="/devs/atlas">Language Atlas</Link>{" "}
          for a choropleth map of the dominant programming language per country, or{" "}
          <Link href="/explore">explore all GitHub developers</Link>{" "}
          on the global heatmap.
        </p>
      </div>

      <DevsLanguageClient initialSlug={decodedSlug} />
    </>
  );
};

export default function DevsLanguagePage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <DevsLanguagePageContent params={params} />
    </Suspense>
  );
}
