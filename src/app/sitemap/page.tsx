// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { LANGUAGE_SLUG_MAP } from "@/lib/languages";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

export const metadata: Metadata = {
  title: "Sitemap | StarMapper",
  description: "Complete directory of all StarMapper pages: stargazer maps, developer maps, language atlas, profiles, and tools.",
  alternates: { canonical: "/sitemap" },
  openGraph: {
    title: "Sitemap | StarMapper",
    description: "Complete directory of all StarMapper pages: stargazer maps, developer maps, language atlas, profiles, and tools.",
    url: `${APP_URL}/sitemap`,
    siteName: "StarMapper",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Sitemap | StarMapper",
    description: "Complete directory of all StarMapper pages.",
  },
};

type Section = {
  heading: string;
  description: string;
  links: { href: string; label: string; desc?: string }[];
};

const SECTIONS: Section[] = [
  {
    heading: "Core tools",
    description: "Main features of StarMapper.",
    links: [
      { href: "/", label: "Home", desc: "Paste a GitHub repo URL and map its stargazers" },
      { href: "/explore", label: "Explore developers", desc: "Heatmap of GitHub developers worldwide" },
      { href: "/trending", label: "Trending repos", desc: "Repos gaining stars fastest right now" },
      { href: "/repos", label: "Community maps", desc: "All repos scanned by the community" },
    ],
  },
  {
    heading: "Developer maps",
    description: "Interactive maps filtered by programming language.",
    links: [
      { href: "/devs", label: "Dev Maps hub", desc: "All language maps in one place" },
      { href: "/devs/atlas", label: "Language Atlas", desc: "Dominant programming language per country" },
      ...Object.keys(LANGUAGE_SLUG_MAP)
        .sort()
        .map((slug) => ({
          href: `/devs/${slug}`,
          label: LANGUAGE_SLUG_MAP[slug],
          desc: `Map of ${LANGUAGE_SLUG_MAP[slug]} developers`,
        })),
    ],
  },
  {
    heading: "Comparisons",
    description: "How StarMapper compares to similar tools.",
    links: [
      { href: "/vs/star-history", label: "vs GitHub Star History", desc: "Time charts vs geographic maps" },
    ],
  },
  {
    heading: "Feeds",
    description: "Developer announcement feeds via RSS and JSON Feed.",
    links: [
      { href: "/feeds", label: "Feeds directory", desc: "Browse all developer announcement feeds" },
    ],
  },
  {
    heading: "Info",
    description: "Documentation and legal.",
    links: [
      { href: "/faq", label: "FAQ", desc: "Frequently asked questions about StarMapper" },
      { href: "/organic-score/calibration", label: "Organic Score calibration", desc: "Methodology and calibration corpus for the Organic Score" },
      { href: "/changelog", label: "Changelog", desc: "What changed in each release" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
      { href: "/legal", label: "Legal notice" },
    ],
  },
];

export default function SitemapPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "StarMapper sitemap",
    url: `${APP_URL}/sitemap`,
    numberOfItems: SECTIONS.reduce((acc, s) => acc + s.links.length, 0),
    itemListElement: SECTIONS.flatMap((s, si) =>
      s.links.map((l, li) => ({
        "@type": "ListItem",
        position: si * 100 + li + 1,
        name: l.label,
        url: `${APP_URL}${l.href}`,
      }))
    ),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Header sticky showNav innerMaxWidth="max-w-7xl" />

      <main id="main" className="w-full max-w-7xl mx-auto px-4 lg:px-6 pt-24 pb-20">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="text-xs text-muted-subtle hover:text-muted transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
            <li>
              <span className="text-xs text-muted" aria-current="page">Sitemap</span>
            </li>
          </ol>
        </nav>

        <h1 className="text-2xl font-bold text-foreground mb-2">Sitemap</h1>
        <p className="text-muted text-sm mb-10 leading-relaxed">
          Every page on StarMapper, organized by section.
        </p>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-1">
                {section.heading}
              </h2>
              <p className="text-xs text-muted mb-4">{section.description}</p>
              <ul className="divide-y divide-border-subtle border border-border-subtle rounded-xl overflow-hidden">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="flex items-start justify-between gap-4 px-4 py-3 bg-surface hover:bg-surface-alt transition-colors group"
                    >
                      <span className="text-sm font-medium text-accent-blue group-hover:underline">
                        {link.label}
                      </span>
                      {link.desc && (
                        <span className="text-xs text-muted text-right shrink-0 max-w-xs hidden sm:block">
                          {link.desc}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <Footer />
    </>
  );
}
