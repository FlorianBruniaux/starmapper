// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";
import { MapPin, Database } from "lucide-react";

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
          <MapPin size={14} className="text-accent-blue" aria-hidden="true" />
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
          <Database size={14} className="text-accent-green" aria-hidden="true" />
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
