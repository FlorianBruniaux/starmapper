// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Sponsor StarMapper",
  description:
    "Support StarMapper and get visibility in front of a global open-source developer audience. See our current sponsors and learn how to become one.",
  robots: { index: true, follow: true },
};

export default function SponsorPage() {
  return (
    <>
      <Header sticky showNav />

      <main id="main" className="w-full max-w-7xl mx-auto px-4 lg:px-6 pt-24 pb-20">

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 list-none p-0 m-0">
            <li>
              <Link href="/" className="text-xs text-muted-subtle hover:text-muted transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
            <li>
              <span className="text-xs text-muted" aria-current="page">Sponsor</span>
            </li>
          </ol>
        </nav>

        <h1 className="text-2xl font-bold text-foreground mb-2">Support StarMapper</h1>
        <p className="text-sm text-muted mb-10 leading-relaxed">
          StarMapper is free, open-source, and has no ads. It runs on the support of partners
          who believe developers deserve open access to GitHub community data. If your company
          benefits from the open-source ecosystem, sponsoring StarMapper is a direct way to
          give back and get in front of the people who build it.
        </p>

        {/* ── Sponsors ── */}
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-subtle mb-4">
          Sponsors
        </h2>

        <div className="mb-10">
          <a
            href="https://www.jawg.io/?utm_source=starmapper&utm_medium=sponsor-page"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 bg-surface border border-border-subtle rounded-lg px-5 py-5 hover:border-accent-blue/40 transition-colors group"
          >
            <div className="mt-0.5 size-10 shrink-0 flex items-center justify-center rounded-md bg-accent-blue/8">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className="text-accent-blue" aria-hidden="true">
                <path d="M8 0a5.5 5.5 0 0 0-5.5 5.5c0 1.75.74 3.32 1.93 4.43L8 16l3.57-6.07A5.48 5.48 0 0 0 13.5 5.5 5.5 5.5 0 0 0 8 0Zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-semibold text-foreground group-hover:text-accent-blue transition-colors">
                  Jawg Maps
                </span>
                <span className="text-2xs bg-accent-blue/10 text-accent-blue border border-accent-blue/20 rounded-full px-2 py-0.5 font-medium">
                  Sponsor
                </span>
              </div>
              <p className="text-sm text-muted leading-relaxed mb-3">
                Jawg powers every map tile you see on StarMapper and the geocoding cascade
                that turns "San Francisco Bay Area" or "Paris" into a precise pin on the map.
                Their dedicated StarMapper instance handles the whole geocoding load — no other
                provider covers that.
              </p>
              <span className="text-xs text-accent-blue group-hover:underline">
                jawg.io ↗
              </span>
            </div>
          </a>
        </div>

        {/* ── Infrastructure Partners ── */}
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-subtle mb-4">
          Infrastructure Partners
        </h2>

        <div className="mb-12">
          <a
            href="https://neon.tech/?ref=starmapper"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 bg-surface border border-border-subtle rounded-lg px-5 py-4 hover:border-accent-blue/40 transition-colors group"
          >
            <div className="mt-0.5 size-8 shrink-0 flex items-center justify-center rounded-md bg-accent-green/8">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green" aria-hidden="true">
                <path d="M1 3.5c0-1.38 3.13-2.5 7-2.5s7 1.12 7 2.5v9c0 1.38-3.13 2.5-7 2.5s-7-1.12-7-2.5v-9Zm6 8.5c-3.31 0-5.5-.9-5.5-1.5v-1.24c1.18.71 3.17 1.24 5.5 1.24s4.32-.53 5.5-1.24V10.5c0 .6-2.19 1.5-5.5 1.5Zm0-4c-3.31 0-5.5-.9-5.5-1.5V5.26C2.68 5.97 4.67 6.5 7 6.5s4.32-.53 5.5-1.24V6.5c0 .6-2.19 1.5-5.5 1.5Zm0-4C4.19 4 2 3.1 2 2.5 2 1.9 4.19 1 7 1s5 .9 5 1.5S9.81 4 7 4Z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground group-hover:text-accent-blue transition-colors">
                  Neon
                </span>
                <span className="text-2xs bg-accent-green/10 text-accent-green border border-accent-green/20 rounded-full px-2 py-0.5 font-medium">
                  Infrastructure Partner
                </span>
              </div>
              <p className="text-xs text-muted leading-relaxed mb-2">
                Neon's serverless Postgres stores the geocache (~51k pre-seeded entries),
                full scan results, and badge stats that make StarMapper instant for returning
                visitors — without any always-on server to manage.
              </p>
              <span className="text-xs text-accent-blue group-hover:underline">
                neon.tech ↗
              </span>
            </div>
          </a>
        </div>

        {/* ── Become a Sponsor ── */}
        <div className="bg-surface border border-border-subtle rounded-lg px-6 py-6">
          <h2 className="text-sm font-semibold text-foreground mb-2">Want to sponsor StarMapper?</h2>
          <p className="text-xs text-muted leading-relaxed mb-5">
            StarMapper is used daily by open-source maintainers, developers, and curious
            people exploring the global GitHub community. Your logo and link on the map page,
            landing page, and this page — in front of a technical audience that actually cares
            about the tools they use.
          </p>
          <ul className="text-xs text-muted space-y-1.5 mb-6">
            <li className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green mt-0.5 shrink-0" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
              Attribution on every map (badge + attribution bar, all pages)
            </li>
            <li className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green mt-0.5 shrink-0" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
              Listing on the landing page and this sponsor page
            </li>
            <li className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green mt-0.5 shrink-0" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
              Direct reach to open-source developers, maintainers, and contributors
            </li>
          </ul>
          <a
            href="mailto:florian@bruniaux.com?subject=StarMapper%20Sponsorship%20Inquiry"
            className="inline-flex items-center gap-2 bg-accent-green-emphasis hover:opacity-90 text-white font-bold py-2.5 px-5 rounded-lg text-sm transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.809v6.442Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88Z" />
            </svg>
            Get in touch
          </a>
        </div>

      </main>

      <Footer />
    </>
  );
}
