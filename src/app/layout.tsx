// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "StarMapper — Map your GitHub stargazers",
  description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
  metadataBase: new URL(APP_URL),
  alternates: { canonical: "/" },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "StarMapper — Map your GitHub stargazers",
    description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
    siteName: "StarMapper",
    type: "website",
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "StarMapper — Map your GitHub stargazers",
    description: "See where in the world your GitHub repo's fans are — geocoded, clustered, and beautiful.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${APP_URL}/#app`,
      name: "StarMapper",
      url: APP_URL,
      description:
        "StarMapper visualizes where your GitHub repository's stargazers are located on an interactive world map. It geocodes user locations, clusters them by geography, and shows country/city statistics — free, with no login required.",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
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
      founder: {
        "@type": "Person",
        name: "Florian Bruniaux",
        url: "https://bruniaux.com",
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${APP_URL}/#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "What is StarMapper?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "StarMapper is a free web tool that shows you where your GitHub repository's stargazers are located. It fetches all stargazers via the GitHub API, geocodes their profile locations, and renders them on an interactive world map with country, city, and company statistics.",
          },
        },
        {
          "@type": "Question",
          name: "Is StarMapper free to use?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes, StarMapper is completely free. No account, no login, and no credit card required. Just paste a GitHub repository URL and click Map It.",
          },
        },
        {
          "@type": "Question",
          name: "How does StarMapper work?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "StarMapper fetches the list of stargazers for a GitHub repository using the GitHub GraphQL API. It then geocodes each user's self-reported location using a shared geocoding cache. The results are rendered on an interactive MapLibre GL map with native clustering, grouped by country and city.",
          },
        },
        {
          "@type": "Question",
          name: "Does StarMapper work with private repositories?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "StarMapper only works with public GitHub repositories. Private repository data is not accessible via the public GitHub API.",
          },
        },
        {
          "@type": "Question",
          name: "How accurate is the stargazer location data?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Location accuracy depends on what GitHub users enter in their profile. StarMapper geocodes free-text location fields, so accuracy varies. On average, 60–80% of stargazers have a mappable location. Users who leave their location blank appear in the 'Unmapped' list.",
          },
        },
        {
          "@type": "Question",
          name: "Can I embed a StarMapper badge in my README?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. After scanning a repository, StarMapper generates an embeddable SVG badge showing the star count and number of mapped countries. You can copy the Markdown snippet directly from the map page.",
          },
        },
        {
          "@type": "Question",
          name: "Where does the stargazer data come from?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "StarMapper uses the GitHub public API (GraphQL + REST) with an authenticated token to access publicly visible profile fields: username, display name, and the self-declared location field. Location text is geocoded using Jawg, Geoapify, and Nominatim. Results are displayed as geographic clusters, not searchable individual records. See our Privacy Policy for details.",
          },
        },
        {
          "@type": "Question",
          name: "How do I request removal of my data from StarMapper?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Send an email to florian@bruniaux.com with your GitHub username and confirmation that you own the account. We will delete your profile data and star events within 30 days. Alternatively, remove your location from your GitHub profile settings — the next scan will reflect the change automatically.",
          },
        },
      ],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Theme init — must run synchronously before first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script
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
      </body>
    </html>
  );
}
