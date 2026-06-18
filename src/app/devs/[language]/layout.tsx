// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import { displayLanguage, slugToLanguage } from "@/lib/languages";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ language: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { language: slug } = await params;
  const language = displayLanguage(slugToLanguage(slug) ?? slug);

  const title = `${language} Developers World Map | StarMapper`;
  const description = `See where ${language} developers are located worldwide. Interactive map of GitHub contributors who code in ${language}, filtered by country, city, and company.`;
  const url = `${APP_URL}/devs/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: `/devs/${slug}` },
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

const LanguageLayoutMeta = async ({
  params,
}: {
  params: Promise<{ language: string }>;
}) => {
  const { language: slug } = await params;
  const language = displayLanguage(slugToLanguage(slug) ?? slug);
  const url = `${APP_URL}/devs/${slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "StarMapper", item: APP_URL },
      { "@type": "ListItem", position: 2, name: "Developers", item: `${APP_URL}/devs` },
      { "@type": "ListItem", position: 3, name: `${language} developers`, item: url },
    ],
  };

  return (
    <>
      <h1 className="sr-only">{language} developers world map</h1>
      <script
        type="application/ld+json"
        // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
};

export default function LanguageLayout({ params, children }: Props) {
  return (
    <>
      <Suspense fallback={null}>
        <LanguageLayoutMeta params={params} />
      </Suspense>
      {children}
    </>
  );
}
