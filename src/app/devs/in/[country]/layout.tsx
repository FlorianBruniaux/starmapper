// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import { slugToCountry } from "@/lib/countries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ country: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { country: slug } = await params;
  const countryName = slugToCountry(slug);
  const url = `${APP_URL}/devs/in/${slug}`;

  const title = `GitHub Developers in ${countryName} | StarMapper`;
  const description =
    `Interactive map of GitHub developers from ${countryName}, broken down by programming language` +
    ` and city. Based on geocoded profile data from ${countryName}'s developer community.`;

  return {
    title,
    description,
    alternates: { canonical: `/devs/in/${slug}` },
    openGraph: { title, description, url, siteName: "StarMapper", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const CountryLayoutMeta = async ({
  params,
}: {
  params: Promise<{ country: string }>;
}) => {
  const { country: slug } = await params;
  const countryName = slugToCountry(slug);
  const url = `${APP_URL}/devs/in/${slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `GitHub Developers in ${countryName}`,
    description: `Geocoded GitHub developer data for ${countryName}, broken down by programming language.`,
    url,
    creator: { "@type": "Organization", name: "StarMapper", url: APP_URL },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "StarMapper", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Developers", item: `${APP_URL}/devs` },
        {
          "@type": "ListItem",
          position: 3,
          name: `Developers in ${countryName}`,
          item: url,
        },
      ],
    },
  };

  return (
    <>
      <h1 className="sr-only">GitHub developers in {countryName}</h1>
      <script
        type="application/ld+json"
        // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
};

export default function CountryLayout({ params, children }: Props) {
  return (
    <>
      <Suspense fallback={null}>
        <CountryLayoutMeta params={params} />
      </Suspense>
      {children}
    </>
  );
}
