// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";

export const SponsorsBlock = () => (
  <section className="w-full max-w-7xl mx-auto px-4 lg:px-6 pb-12">
    <p className="text-muted-subtle text-2xs uppercase tracking-widest mb-5 text-center">
      Powered by
    </p>
    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
      {/* Jawg — primary sponsor */}
      <a
        href="https://www.jawg.io/?utm_source=starmapper&utm_medium=sponsors-block"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Jawg Maps — map tiles and geocoding sponsor (opens in new tab)"
        className="flex items-center gap-3 bg-surface border border-border-subtle rounded-lg px-5 py-3 hover:border-accent-blue/40 transition-colors group"
      >
        <div className="size-8 shrink-0 flex items-center justify-center rounded-md bg-accent-blue/8">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-blue" aria-hidden="true">
            <path d="M8 0a5.5 5.5 0 0 0-5.5 5.5c0 1.75.74 3.32 1.93 4.43L8 16l3.57-6.07A5.48 5.48 0 0 0 13.5 5.5 5.5 5.5 0 0 0 8 0Zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-medium text-foreground group-hover:text-accent-blue transition-colors">
            Jawg Maps
          </div>
          <div className="text-2xs text-muted">Maps &amp; geocoding</div>
        </div>
      </a>

      {/* Neon — infrastructure partner */}
      <a
        href="https://neon.tech/?ref=starmapper"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Neon — serverless Postgres infrastructure partner (opens in new tab)"
        className="flex items-center gap-3 bg-surface border border-border-subtle rounded-lg px-5 py-3 hover:border-accent-blue/40 transition-colors group"
      >
        <div className="size-8 shrink-0 flex items-center justify-center rounded-md bg-accent-green/8">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green" aria-hidden="true">
            <path d="M1 3.5c0-1.38 3.13-2.5 7-2.5s7 1.12 7 2.5v9c0 1.38-3.13 2.5-7 2.5s-7-1.12-7-2.5v-9Zm6 8.5c-3.31 0-5.5-.9-5.5-1.5v-1.24c1.18.71 3.17 1.24 5.5 1.24s4.32-.53 5.5-1.24V10.5c0 .6-2.19 1.5-5.5 1.5Zm0-4c-3.31 0-5.5-.9-5.5-1.5V5.26C2.68 5.97 4.67 6.5 7 6.5s4.32-.53 5.5-1.24V6.5c0 .6-2.19 1.5-5.5 1.5Zm0-4C4.19 4 2 3.1 2 2.5 2 1.9 4.19 1 7 1s5 .9 5 1.5S9.81 4 7 4Z" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-medium text-foreground group-hover:text-accent-blue transition-colors">
            Neon
          </div>
          <div className="text-2xs text-muted">Serverless Postgres</div>
        </div>
      </a>
    </div>

    <p className="text-center">
      <Link
        href="/sponsor"
        className="text-2xs text-muted hover:text-foreground transition-colors"
      >
        Become a sponsor →
      </Link>
    </p>
  </section>
);
