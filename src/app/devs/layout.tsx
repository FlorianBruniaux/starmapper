// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const DESC = "Explore interactive maps of GitHub developers filtered by programming language. See where Rust, Python, TypeScript, and Go developers are located worldwide.";

export const metadata: Metadata = {
  title: "Dev Maps: Explore GitHub Developers by Language | StarMapper",
  description: DESC,
  alternates: { canonical: "/devs" },
  openGraph: {
    title: "Dev Maps: Explore GitHub Developers by Language | StarMapper",
    description: DESC,
    url: `${APP_URL}/devs`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
    title: "Dev Maps: Explore GitHub Developers by Language | StarMapper",
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

export default function DevsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
