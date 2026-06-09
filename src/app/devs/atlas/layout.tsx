// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const DESC = "Interactive choropleth map showing the most popular programming language per country, based on GitHub developer data.";

export const metadata: Metadata = {
  title: "Language Atlas: Dominant Programming Language by Country | StarMapper",
  description: DESC,
  alternates: { canonical: "/devs/atlas" },
  openGraph: {
    title: "Language Atlas: Dominant Programming Language by Country | StarMapper",
    description: DESC,
    url: `${APP_URL}/devs/atlas`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "Language Atlas: Dominant Programming Language by Country | StarMapper",
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
