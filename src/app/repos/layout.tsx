// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "Community Maps: Mapped GitHub Repos | StarMapper",
  description:
    "Browse repos already mapped on StarMapper. Discover where open-source projects have their most fans, sorted by star count.",
  alternates: { canonical: "/repos" },
  openGraph: {
    title: "Community Maps: Mapped GitHub Repos | StarMapper",
    description:
      "Browse repos already mapped on StarMapper. Discover where open-source projects have their most fans.",
    url: `${APP_URL}/repos`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "Community Maps: Mapped GitHub Repos | StarMapper",
    description:
      "Browse repos already mapped on StarMapper.",
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function ReposLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
