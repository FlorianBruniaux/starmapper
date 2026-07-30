// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LOGIN_RE } from "@/lib/api-validation";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

type Props = {
  params: Promise<{ login: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  if (!LOGIN_RE.test(login)) notFound();

  const title = `${login} on StarMapper | repos, location & starred projects`;
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
      site: "@FlorianBruniaux",
      title,
      description,
    },
  };
}

const ProfileJsonLd = async ({ params }: { params: Promise<{ login: string }> }) => {
  const { login } = await params;
  if (!LOGIN_RE.test(login)) notFound();
  const nonce = (await headers()).get("x-nonce") ?? "";
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
    <script
      nonce={nonce}
      type="application/ld+json"
      // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
};

export default function ProfileLayout({
  params,
  children,
}: {
  params: Promise<{ login: string }>;
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <ProfileJsonLd params={params} />
      </Suspense>
      {children}
    </>
  );
}
