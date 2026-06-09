// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const DESC = "Explore a heatmap of GitHub developers across the world. Discover where open-source contributors are most concentrated.";

export const metadata: Metadata = {
  title: "Explore GitHub Developers Worldwide | StarMapper",
  description: DESC,
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Explore GitHub Developers Worldwide | StarMapper",
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
    title: "Explore GitHub Developers Worldwide | StarMapper",
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
