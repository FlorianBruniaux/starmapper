// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal — StarMapper",
  description: "Legal information for StarMapper: Privacy Policy, Terms of Service, and contact details.",
  robots: { index: true, follow: true },
};

const cards = [
  {
    href: "/privacy",
    title: "Privacy Policy",
    desc: "How we collect, store, and process public GitHub stargazer data. Your GDPR rights and how to exercise them.",
    icon: (
      <path d="M4 1.75C4 .784 4.784 0 5.75 0h5a.75.75 0 0 1 .53.22l3.5 3.5c.141.14.22.331.22.53v10a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 11 3.25V1.5Zm6.75.062V3.25c0 .138.112.25.25.25h1.688l-1.938-1.938ZM8.75 9a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8.75 9ZM7.25 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
    ),
  },
  {
    href: "/terms",
    title: "Terms of Service",
    desc: "Acceptable use policy, disclaimers, limitation of liability, and governing law (French law / CNIL).",
    icon: (
      <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Z" />
    ),
  },
];

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-14">

        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground mb-10 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
          </svg>
          Back to StarMapper
        </Link>

        <h1 className="text-2xl font-bold text-foreground mb-2">Legal</h1>
        <p className="text-sm text-muted mb-10 leading-relaxed">
          StarMapper is operated by <strong className="text-foreground">Florian Bruniaux</strong>, France. Governed by French law,
          under CNIL jurisdiction. Open-source under AGPL-3.0.
        </p>

        <div className="grid gap-4 mb-12">
          {cards.map(({ href, title, desc, icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-start gap-4 bg-surface border border-border-subtle rounded-lg px-5 py-4 hover:border-accent-blue/40 transition-colors group"
            >
              <div className="mt-0.5 size-8 shrink-0 flex items-center justify-center rounded-md bg-accent-blue/8">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-accent-blue" aria-hidden="true">
                  {icon}
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-foreground group-hover:text-accent-blue transition-colors mb-1">{title}</div>
                <div className="text-xs text-muted leading-relaxed">{desc}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Contact */}
        <div className="bg-surface border border-border-subtle rounded-lg px-5 py-4 mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3">Data Protection Contact</h2>
          <div className="space-y-2 text-sm text-muted">
            <p>
              For GDPR requests (access, erasure, objection):{" "}
              <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
                florian@bruniaux.com
              </a>
            </p>
            <p>
              Supervisory authority:{" "}
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-blue hover:underline"
              >
                CNIL — cnil.fr/fr/plaintes
              </a>
            </p>
            <p>
              Source code:{" "}
              <a
                href="https://github.com/FlorianBruniaux"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-blue hover:underline"
              >
                github.com/FlorianBruniaux
              </a>{" "}
              (AGPL-3.0)
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
