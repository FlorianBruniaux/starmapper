// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OWNER_REPO_RE } from "@/lib/api-validation";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) notFound();

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

export default async function RepoLayout({
  params,
  children,
}: {
  params: Promise<{ owner: string; repo: string }>;
  children: React.ReactNode;
}) {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) notFound();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "StarMapper", item: APP_URL },
      { "@type": "ListItem", position: 2, name: owner, item: `${APP_URL}/${owner}` },
      { "@type": "ListItem", position: 3, name: `${owner}/${repo}`, item: `${APP_URL}/${owner}/${repo}` },
    ],
  };
  return (
    <>
      <h1 className="sr-only">{owner}/{repo} stargazers map</h1>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {children}
    </>
  );
}
