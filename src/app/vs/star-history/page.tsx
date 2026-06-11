// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://starmapper.bruniaux.com";

const TITLE = "StarMapper vs GitHub Star History";
const DESC =
  "star-history.com answers when your GitHub repo gained stars. StarMapper answers where your stargazers live. Two complementary tools; most open-source maintainers end up using both.";

export const metadata: Metadata = {
  title: `${TITLE} | StarMapper`,
  description: DESC,
  alternates: { canonical: "/vs/star-history" },
  openGraph: {
    title: `${TITLE} | StarMapper`,
    description: DESC,
    url: `${APP_URL}/vs/star-history`,
    siteName: "StarMapper",
    type: "website",
    images: [{ url: `${APP_URL}/opengraph-image`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FlorianBruniaux",
    title: `${TITLE} | StarMapper`,
    description: DESC,
    images: [`${APP_URL}/opengraph-image`],
  },
};

const COMPARISON = [
  {
    criterion: "What it answers",
    starHistory: "When did your repo gain stars? Growth over time.",
    starMapper: "Where are your stargazers located? Geographic distribution.",
  },
  {
    criterion: "Main visual",
    starHistory: "Line chart, star count vs date.",
    starMapper: "Interactive world map with clustered points by location.",
  },
  {
    criterion: "Data shown",
    starHistory: "Star count over time, growth rate, milestones.",
    starMapper: "Country, city, company breakdowns. Top stargazers by followers.",
  },
  {
    criterion: "Embeds",
    starHistory: "Star history chart image for README.",
    starMapper: "Badge (star count + countries) and scatter map image for README.",
  },
  {
    criterion: "Login required",
    starHistory: "No, paste a repo URL.",
    starMapper: "No, paste a repo URL.",
  },
  {
    criterion: "Price",
    starHistory: "Free.",
    starMapper: "Free.",
  },
];

const FAQS = [
  {
    q: "Is StarMapper a replacement for GitHub Star History?",
    a: "No, they answer different questions. GitHub Star History (star-history.com) tracks star growth over time, which makes it useful for spotting viral moments or measuring marketing campaigns. StarMapper shows the geographic distribution of your current stargazers so you understand where your audience actually comes from. Most maintainers use both.",
  },
  {
    q: "Can I see both time charts and a world map for my repo?",
    a: "Yes, use each tool independently. Paste your repo URL into star-history.com for a growth chart, then paste the same URL into StarMapper for a world map. Both are free and require no account.",
  },
  {
    q: "Does StarMapper show star history over time?",
    a: "Not currently. StarMapper focuses on geographic distribution: which countries and cities your stargazers come from, which companies they work at, and who your most influential supporters are. For time-based star charts, star-history.com is the right tool.",
  },
  {
    q: "Which repos work with StarMapper?",
    a: "Any public GitHub repository. Paste the URL (e.g. github.com/owner/repo) and StarMapper fetches all stargazers via the GitHub API, geocodes their locations, and renders them on an interactive world map.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Comparisons", item: `${APP_URL}/vs` },
        { "@type": "ListItem", position: 3, name: "StarMapper vs GitHub Star History", item: `${APP_URL}/vs/star-history` },
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

export default function VsStarHistoryPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Header sticky showNav innerMaxWidth="max-w-7xl" />

      <main id="main" className="w-full max-w-7xl mx-auto px-4 lg:px-6 pt-24 pb-20 space-y-14">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="text-xs text-muted-subtle hover:text-muted transition-colors">Home</Link>
            </li>
            <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
            <li>
              <span className="text-xs text-muted" aria-current="page">vs GitHub Star History</span>
            </li>
          </ol>
        </nav>

        {/* Hero */}
        <section className="space-y-4">
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            GitHub Star History vs StarMapper
          </h1>
          <p className="text-muted leading-relaxed">
            Two free tools, two different questions.{" "}
            <a
              href="https://star-history.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              star-history.com
            </a>{" "}
            answers <strong className="text-foreground">when</strong> your repo grew.
            StarMapper answers <strong className="text-foreground">where</strong> your stargazers are, and most maintainers end up using both.
          </p>
        </section>

        {/* Comparison — cards on mobile, table on desktop */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Side-by-side comparison
          </h2>

          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {COMPARISON.map((row) => (
              <div key={row.criterion} className="rounded-xl border border-border bg-surface p-4 space-y-3">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">{row.criterion}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-2xs font-medium text-muted mb-1">Star History</p>
                    <p className="text-xs text-muted leading-snug">{row.starHistory}</p>
                  </div>
                  <div>
                    <p className="text-2xs font-medium text-accent-blue mb-1">StarMapper</p>
                    <p className="text-xs text-foreground leading-snug">{row.starMapper}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider w-1/4">Criterion</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider w-3/8">
                    GitHub Star History
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-accent-blue uppercase tracking-wider w-3/8">
                    StarMapper
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {COMPARISON.map((row) => (
                  <tr key={row.criterion} className="bg-surface hover:bg-surface-alt transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-foreground align-top">{row.criterion}</td>
                    <td className="px-4 py-3 text-xs text-muted align-top">{row.starHistory}</td>
                    <td className="px-4 py-3 text-xs text-foreground align-top">{row.starMapper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Use case block */}
        <section className="rounded-xl border border-border bg-surface p-6 space-y-3">
          <h2 className="text-base font-semibold text-foreground">How maintainers use both</h2>
          <p className="text-sm text-muted leading-relaxed">
            A typical workflow: check star-history.com to see if a recent blog post or HackerNews mention
            caused a star spike, then open StarMapper on the same repo to see which countries those new
            stargazers came from. The two tools give you the full picture: <em>when</em> the growth happened
            and <em>where</em> it came from.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-accent-green-emphasis hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity"
            >
              Map your repo on StarMapper
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06l2.97-2.97H3.75a.75.75 0 0 1 0-1.5h7.44L8.22 4.03a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </Link>
          </div>
        </section>

        {/* FAQ */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Frequently asked questions
          </h2>
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
        </section>
      </main>

      <Footer />
    </>
  );
}
