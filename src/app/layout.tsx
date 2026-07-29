// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { VitalsReporter } from "@/components/vitals-reporter";
import { StarNudge } from "@/components/star-nudge";
import { TourProvider } from "@/components/tour/tour-provider";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const SITE_DESCRIPTION =
  "Map your GitHub stargazers worldwide. See country breakdowns, identify influential developers, and check the Organic Score (0–100) to detect fake stars. On average 60–80% of stargazers geocoded. Free, no login.";

export const metadata: Metadata = {
  title: "GitHub Stargazers Map | StarMapper",
  description: SITE_DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: "/" },
  keywords: [
    "GitHub stargazers map",
    "GitHub stars by country",
    "who starred my GitHub repo",
    "open source audience analytics",
    "fake GitHub stars detector",
    "detect fake GitHub stars",
    "organic score GitHub",
    "GitHub repository analytics",
    "github contributor map",
    "github stars geographic distribution",
  ],
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
    site: "@FlorianBruniaux",
    creator: "@FlorianBruniaux",
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
        cssSelector: ["h1", "h2", "p.hero-description", ".speakable"],
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
        "StarMapper transforms GitHub stars into geographic intelligence. Enter any public repository URL to see where your stargazers live, which countries are accelerating, who the most influential developers are, and whether the star count is organic. Free, no login, no account required.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      datePublished: "2024-01-01",
      dateModified: "2026-06-09",
      softwareVersion: "0.6.0",
      releaseNotes: `${APP_URL}/changelog`,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free, no account required",
      },
      featureList: [
        "Interactive world map of GitHub stargazers with clustering",
        "Organic Score: detect whether star counts are real or farmed",
        "Developer profiles with personal map and nearby developers",
        "Language Atlas: dominant programming language per country",
        "Animated timelapse of star acquisition over time",
        "Multi-repo comparison: overlay two audiences on the same map",
        "Watch mode: live star tracking during launches",
        "Geographic velocity: which countries are accelerating",
        "Chrome Extension for GitHub repo and profile pages",
        "RSS and JSON Feed for developer news announcements",
        "Public GeoJSON API for geographic star data",
        "Embeddable badge and map image for READMEs",
        "Follower filter to find your most influential stargazers",
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
        "https://x.com/FlorianBruniaux",
      ],
      founder: {
        "@type": "Person",
        name: "Florian Bruniaux",
        url: "https://bruniaux.com",
      },
    },
  ],
};

// Inline script: runs before first paint to apply saved theme and prevent FOUC.
// Placed at start of <body> via Suspense so it runs before any visible content.
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

// Reads x-nonce from request headers (set by middleware for CSP).
// Wrapped in <Suspense> so cacheComponents can prerender the outer layout shell
// while this async component stays per-request.
const DynamicScripts = async () => {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </>
  );
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable}`}>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Preconnect to tile/geocoding origins, shaves 100-300ms off map LCP */}
        <link rel="preconnect" href="https://tile.jawg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.jawg.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://avatars.githubusercontent.com" />
        <link rel="preconnect" href="https://api.github.com" />
      </head>
      <body className={`${geist.className} bg-background`}>
        {/* Scripts need the per-request nonce from middleware — Suspense allows
            the outer layout shell to be statically prerenderable while these
            script tags remain dynamic (resolved before any visible content). */}
        <Suspense fallback={null}>
          <DynamicScripts />
        </Suspense>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-skip-link
                     focus:bg-surface focus:border focus:border-accent-blue focus:rounded-md
                     focus:px-4 focus:py-2 focus:text-sm focus:text-accent-blue focus:shadow-lg"
        >
          Skip to content
        </a>
        <TourProvider>
          {children}
        </TourProvider>
        <VitalsReporter />
        <StarNudge />
      </body>
    </html>
  );
}
