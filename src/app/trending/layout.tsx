// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trending GitHub Repos | StarMapper",
  description: "Most-starred GitHub repositories mapped in the last 7 days. See where your community's attention is going, by country.",
  alternates: { canonical: "/trending" },
  openGraph: {
    title: "Trending GitHub Repos | StarMapper",
    description: "Most-starred GitHub repositories mapped in the last 7 days. See where your community's attention is going, by country.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function TrendingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
