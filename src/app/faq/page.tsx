// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "FAQ — StarMapper",
  description:
    "Frequently asked questions about StarMapper — scan speed, data privacy, GitHub token storage, open source license, badge embeds, and how stargazer geocoding works.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ — StarMapper",
    description:
      "Frequently asked questions about StarMapper — scan speed, data privacy, GitHub token storage, open source license, badge embeds, and how stargazer geocoding works.",
    url: `${APP_URL}/faq`,
    siteName: "StarMapper",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAQ — StarMapper",
    description:
      "Frequently asked questions about StarMapper — scan speed, data privacy, GitHub token storage, open source license, badge embeds, and how stargazer geocoding works.",
  },
};

const FAQS = [
  {
    q: "Is StarMapper free?",
    a: "Yes — no account, no login, no credit card. Paste a repo URL and click Map Stargazers.",
  },
  {
    q: "How long does a scan take?",
    a: "Small repos (under 500 stars) scan in under 10 seconds. Large repos (50k+ stars) take a few minutes — the GitHub API processes users in batches of 100. Once a repo is scanned, the result is cached globally: any subsequent visitor loads it instantly, no re-scan needed.",
  },
  {
    q: "Will my GitHub token be stored?",
    a: "No. Your token is saved in your browser's localStorage only — it never leaves your device except to authenticate directly with the GitHub API. StarMapper does not store tokens server-side.",
  },
  {
    q: "Is StarMapper open source?",
    a: "Yes. StarMapper is open source under the AGPL-3.0 license. The full source code is available on GitHub.",
  },
  {
    q: "How accurate is the location data?",
    a: "Accuracy depends on what GitHub users enter in their profile. On average 60–80% of stargazers have a geocodable location. Users without a location appear in the Unmapped list.",
  },
  {
    q: "Does it work with private repos?",
    a: "No. StarMapper only works with public repositories — the GitHub API does not expose stargazer data for private repos.",
  },
  {
    q: "Can I embed a badge in my README?",
    a: "Yes. After scanning a repo, StarMapper generates two embeddable assets: an SVG shield badge (star count + countries mapped) and a full scatter map image. Copy the Markdown or HTML snippet directly from the map page.",
  },
  {
    q: "Where does the stargazer data come from?",
    a: "StarMapper uses the GitHub public API (GraphQL + REST) with an authenticated token. We access only publicly visible profile fields: username, display name, and the self-declared location field. No private information is ever accessed. Location text is geocoded using Jawg, Geoapify, and Nominatim. Results are displayed as geographic clusters, not searchable individual records.",
  },
  {
    q: "How do I request removal of my data?",
    a: "Remove your location from your GitHub profile settings — the next scan will reflect the change automatically and your coordinates will no longer be geocoded. To delete existing data, email florian@bruniaux.com with your GitHub username. We will remove your profile data and star events within 30 days.",
  },
  {
    q: "Not on the map?",
    a: "Add a location to your GitHub profile at github.com/settings/profile. The next scan of any repo you've starred will pick it up automatically.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "FAQ", item: `${APP_URL}/faq` },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header sticky showNav innerMaxWidth="max-w-3xl" />

      <main id="main" className="w-full max-w-3xl mx-auto px-4 lg:px-6 pt-24 pb-20">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="text-xs text-muted-subtle hover:text-muted transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
            <li>
              <span className="text-xs text-muted" aria-current="page">FAQ</span>
            </li>
          </ol>
        </nav>

        <h1 className="text-2xl font-bold text-foreground mb-2">Frequently asked questions</h1>
        <p className="text-muted text-sm mb-8 leading-relaxed">
          Everything you need to know about StarMapper — scan speed, privacy, tokens, and embeds.
        </p>

        <div className="flex flex-col divide-y divide-border-subtle border border-border-subtle rounded-xl overflow-hidden">
          {FAQS.map(({ q, a }) => (
            <details key={q} className="group bg-surface">
              <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none text-sm font-medium text-foreground hover:text-accent-blue transition-colors select-none">
                {q}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="shrink-0 text-muted group-open:rotate-180 transition-transform"
                  aria-hidden="true"
                >
                  <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
                </svg>
              </summary>
              <p className="px-5 pb-4 text-sm text-muted leading-relaxed">{a}</p>
            </details>
          ))}
        </div>

        <p className="text-xs text-muted-subtle mt-8 text-center">
          Something missing?{" "}
          <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
            florian@bruniaux.com
          </a>
        </p>
      </main>

      <Footer />
    </>
  );
}
