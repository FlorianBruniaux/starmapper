// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { cacheLife, cacheTag } from "next/cache";
import RoadmapPageClient from "./page.client";
import type { RoadmapVoteResponse } from "@/app/api/roadmap-vote/route";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const TITLE = "Where StarMapper goes from here";
const DESC =
  "GitHub cut off public stargazer access on July 23 2026. Here's what broke, what still works, and four ways StarMapper can go next. Vote on the direction.";

export const metadata: Metadata = {
  title: `${TITLE} | StarMapper`,
  description: DESC,
  alternates: { canonical: "/roadmap" },
  openGraph: {
    title: `${TITLE} | StarMapper`,
    description: DESC,
    url: `${APP_URL}/roadmap`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    title: `${TITLE} | StarMapper`,
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

const EMPTY_TALLIES: RoadmapVoteResponse = { tallies: { A: 0, B: 0, C: 0, D: 0 }, totalVoters: 0 };

const fetchTallies = async (): Promise<RoadmapVoteResponse> => {
  "use cache";
  cacheTag("roadmap-vote-tallies");
  cacheLife("minutes");
  try {
    const res = await fetch(`${APP_URL}/api/roadmap-vote`);
    if (!res.ok) return EMPTY_TALLIES;
    return (await res.json()) as RoadmapVoteResponse;
  } catch {
    return EMPTY_TALLIES;
  }
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: APP_URL },
    { "@type": "ListItem", position: 2, name: "Roadmap", item: `${APP_URL}/roadmap` },
  ],
};

const JsonLdScript = async () => {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
};

const RoadmapContent = async () => {
  const initialTallies = await fetchTallies();
  return <RoadmapPageClient initialTallies={initialTallies} />;
};

export default function RoadmapPage() {
  return (
    <Suspense fallback={null}>
      <JsonLdScript />
      <RoadmapContent />
    </Suspense>
  );
}
