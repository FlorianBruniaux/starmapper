// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";
import { LogoMark } from "@/components/logo";

const PRODUCT_LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/trending", label: "Trending" },
  { href: "/repos", label: "Community maps" },
  { href: "/devs", label: "Dev maps" },
  { href: "/devs/atlas", label: "Language Atlas" },
  { href: "/faq", label: "FAQ" },
  { href: "/changelog", label: "Changelog" },
  { href: "/vs/star-history", label: "vs Star History" },
];

const AUTHOR_LINKS = [
  { href: "https://florian.bruniaux.com/", label: "Blog & Portfolio" },
  { href: "https://www.devw.ai/", label: "Dev With AI (FR)" },
  { href: "https://github.com/FlorianBruniaux", label: "GitHub" },
];

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/legal", label: "Legal" },
  { href: "/sitemap", label: "Sitemap" },
  { href: "/sponsor", label: "Sponsor" },
];

export const Footer = () => (
  <footer className="border-t border-border-subtle mt-0 bg-background">
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
        {/* Brand */}
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <LogoMark />
            <span className="font-semibold text-sm text-foreground">StarMapper</span>
          </div>
          <p className="text-muted text-xs leading-relaxed max-w-[200px]">
            See who stars your repo, on a map. Free, no login required.
          </p>
        </div>

        {/* Product */}
        <div>
          <h2 className="text-foreground text-xs font-semibold uppercase tracking-widest mb-3">
            StarMapper
          </h2>
          <ul className="space-y-2">
            {PRODUCT_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-muted hover:text-foreground text-xs transition-colors"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Author */}
        <div>
          <h2 className="text-foreground text-xs font-semibold uppercase tracking-widest mb-3">
            Author
          </h2>
          <ul className="space-y-2">
            {AUTHOR_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-foreground text-xs transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border-subtle pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          {LEGAL_LINKS.map(({ href, label }) => (
            <Link key={href} href={href} className="text-2xs text-muted-subtle hover:text-muted transition-colors">
              {label}
            </Link>
          ))}
          <a href="mailto:florian@bruniaux.com" className="text-2xs text-muted-subtle hover:text-muted transition-colors">
            florian@bruniaux.com
          </a>
        </div>
        <p className="text-2xs text-muted-subtle shrink-0">
          Free forever · No account required
        </p>
      </div>
    </div>
  </footer>
);
