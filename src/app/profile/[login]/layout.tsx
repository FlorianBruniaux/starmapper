// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ login: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;

  const title = `${login} on StarMapper — repos, location & starred projects`;
  const description = `See the GitHub repositories, location, and starred projects of ${login} on StarMapper's interactive world map.`;
  const url = `${APP_URL}/profile/${login}`;

  return {
    title,
    description,
    alternates: { canonical: `/profile/${login}` },
    openGraph: {
      title,
      description,
      url,
      siteName: "StarMapper",
      type: "profile",
      images: [`https://github.com/${login}.png`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ProfileLayout({
  params,
  children,
}: {
  params: Promise<{ login: string }>;
  children: React.ReactNode;
}) {
  const { login } = await params;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${APP_URL}/profile/${login}`,
    name: login,
    url: `https://github.com/${login}`,
    image: `https://github.com/${login}.png`,
    sameAs: [`https://github.com/${login}`],
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${APP_URL}/profile/${login}`,
    },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  );
}
