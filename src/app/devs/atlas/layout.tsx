// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "Language Atlas — Dominant Programming Language by Country | StarMapper",
  description:
    "Interactive choropleth map showing the most popular programming language per country, based on GitHub developer data.",
  alternates: { canonical: "/devs/atlas" },
  openGraph: {
    title: "Language Atlas — Dominant Programming Language by Country | StarMapper",
    description:
      "Interactive choropleth map showing the most popular programming language per country.",
    url: `${APP_URL}/devs/atlas`,
    siteName: "StarMapper",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Language Atlas — Dominant Programming Language by Country | StarMapper",
    description:
      "Interactive choropleth map showing the most popular programming language per country.",
  },
};

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
