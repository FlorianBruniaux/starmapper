// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "Dev Maps — Explore GitHub Developers by Language | StarMapper",
  description:
    "Explore interactive maps of GitHub developers filtered by programming language. See where Rust, Python, TypeScript, and Go developers are located worldwide.",
  alternates: { canonical: "/devs" },
  openGraph: {
    title: "Dev Maps — Explore GitHub Developers by Language | StarMapper",
    description:
      "Explore interactive maps of GitHub developers filtered by programming language.",
    url: `${APP_URL}/devs`,
    siteName: "StarMapper",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dev Maps — Explore GitHub Developers by Language | StarMapper",
    description:
      "Explore interactive maps of GitHub developers filtered by programming language.",
  },
};

export default function DevsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
