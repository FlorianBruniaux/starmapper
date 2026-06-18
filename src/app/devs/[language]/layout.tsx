// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

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

export default function LanguageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
