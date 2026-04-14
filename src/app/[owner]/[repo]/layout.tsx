// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;

  const title = `${owner}/${repo} stargazers map | StarMapper`;
  const description = `Explore who stars ${owner}/${repo} on an interactive world map. See geographic distribution, top countries, cities, and companies.`;
  const url = `${APP_URL}/${owner}/${repo}`;

  return {
    title,
    description,
    alternates: { canonical: `/${owner}/${repo}` },
    openGraph: {
      title,
      description,
      url,
      siteName: "StarMapper",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
