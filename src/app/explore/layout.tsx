// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const DESC = "Discover which GitHub users have the most followers worldwide. Filter by country, programming language, or company. Top stargazers ranked by followers and activity.";

export const metadata: Metadata = {
  title: "Most Influential GitHub Developers by Country | StarMapper",
  description: DESC,
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Most Influential GitHub Developers by Country | StarMapper",
    description: DESC,
    url: `${APP_URL}/explore`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "Most Influential GitHub Developers by Country | StarMapper",
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
