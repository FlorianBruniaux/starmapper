// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { VitalsReporter } from "@/components/vitals-reporter";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });


const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const SITE_DESCRIPTION =
  "See where your GitHub stargazers are located on an interactive world map. Country, city, and company breakdowns. The geographic layer on top of your GitHub star history. Free, no login.";

export const metadata: Metadata = {
  title: "GitHub Stargazers Map | StarMapper",
  description: SITE_DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: "/" },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "GitHub Stargazers Map | StarMapper",
    description: SITE_DESCRIPTION,
    siteName: "StarMapper",
    type: "website",
    url: APP_URL,
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GitHub Stargazers Map | StarMapper",
    description: SITE_DESCRIPTION,
    images: [`${APP_URL}/opengraph-image`],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${APP_URL}/#webpage`,
      name: "GitHub Stargazers Map | StarMapper",
      description: SITE_DESCRIPTION,
      url: APP_URL,
      inLanguage: "en-US",
      isPartOf: { "@id": `${APP_URL}/#website` },
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: ["h1", "h2"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${APP_URL}/#website`,
      name: "StarMapper",
      url: APP_URL,
      publisher: { "@id": `${APP_URL}/#org` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${APP_URL}/#app`,
      name: "StarMapper",
      url: APP_URL,
      description:
        "StarMapper visualizes where your GitHub repository's stargazers are located on an interactive world map. It geocodes user locations, clusters them by geography, and shows country/city statistics. Free, no login required.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      datePublished: "2024-01-01",
      softwareVersion: "0.4.1",
      releaseNotes: `${APP_URL}/changelog`,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free, no account required",
      },
      featureList: [
        "Interactive world map of GitHub stargazers",
        "Automatic geocoding of user locations",
        "Country and city breakdown statistics",
        "Top contributors by follower count",
        "Embeddable badge with live star count",
        "No login or GitHub account required",
        "Works with any public GitHub repository",
      ],
      screenshot: `${APP_URL}/opengraph-image`,
      author: {
        "@type": "Person",
        name: "Florian Bruniaux",
        url: "https://bruniaux.com",
      },
    },
    {
      "@type": "Organization",
      "@id": `${APP_URL}/#org`,
      name: "StarMapper",
      url: APP_URL,
      sameAs: [
        "https://github.com/FlorianBruniaux/starmapper",
        "https://bruniaux.com",
      ],
      founder: {
        "@type": "Person",
        name: "Florian Bruniaux",
        url: "https://bruniaux.com",
      },
    },
  ],
};

// Inline script: runs before first paint to apply saved theme and prevent FOUC
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('starmapper:theme');
    var preferLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    var resolved = stored === 'light' || stored === 'dark' ? stored : (preferLight ? 'light' : 'dark');
    document.documentElement.classList.add(resolved);
  } catch(e) {
    document.documentElement.classList.add('dark');
  }
})();
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable}`}>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Preconnect to tile/geocoding origins, shaves 100-300ms off map LCP */}
        <link rel="preconnect" href="https://tile.jawg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.jawg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://starmapper.jawg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://avatars.githubusercontent.com" />
        <link rel="preconnect" href="https://api.github.com" />
        {/* Theme init — must run synchronously before first paint */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${geist.className} bg-background`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100]
                     focus:bg-surface focus:border focus:border-accent-blue focus:rounded-md
                     focus:px-4 focus:py-2 focus:text-sm focus:text-accent-blue focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
        <VitalsReporter />
      </body>
    </html>
  );
}
