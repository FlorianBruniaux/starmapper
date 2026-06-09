// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "Trending GitHub Repos | StarMapper",
  description: "Most-starred GitHub repositories mapped in the last 7 days. See where your community's attention is going, by country.",
  alternates: { canonical: "/trending" },
  openGraph: {
    title: "Trending GitHub Repos | StarMapper",
    description: "Most-starred GitHub repositories mapped in the last 7 days. See where your community's attention is going, by country.",
    url: `${APP_URL}/trending`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "Trending GitHub Repos | StarMapper",
    description: "Most-starred GitHub repositories mapped in the last 7 days. See where your community's attention is going, by country.",
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function TrendingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
