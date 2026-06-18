// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const DESC = "Browse GitHub repositories already mapped on StarMapper. See geographic distribution of stars, top countries, and audience analytics for open-source projects.";

export const metadata: Metadata = {
  title: "GitHub Repos — Stargazer Maps & Geographic Data | StarMapper",
  description: DESC,
  alternates: { canonical: "/repos" },
  openGraph: {
    title: "GitHub Repos — Stargazer Maps & Geographic Data | StarMapper",
    description: DESC,
    url: `${APP_URL}/repos`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "GitHub Repos — Stargazer Maps & Geographic Data | StarMapper",
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function ReposLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
