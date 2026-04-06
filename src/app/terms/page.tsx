// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — StarMapper",
  description: "StarMapper terms of service — acceptable use, disclaimers, and governing law.",
  robots: { index: true, follow: true },
};

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="mb-10">
    <h2 className="text-base font-semibold text-foreground mb-3 pb-2 border-b border-border-subtle">{title}</h2>
    <div className="space-y-3 text-sm text-muted leading-relaxed">{children}</div>
  </section>
);

export default function TermsPage() {
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

        <h1 className="text-2xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-xs text-muted-subtle mb-10">Last revised: 6 April 2026</p>

        <Section id="service" title="1. The Service">
          <p>
            StarMapper (&quot;the Service&quot;) is a free web application that visualises the geographic distribution of GitHub repository
            stargazers. It is operated by Florian Bruniaux, an individual based in France (&quot;we&quot;, &quot;us&quot;).
          </p>
          <p>
            By using StarMapper, you agree to these Terms. If you do not agree, do not use the Service.
          </p>
        </Section>

        <Section id="use" title="2. Acceptable Use">
          <p>You may use StarMapper to analyse public GitHub repositories for legitimate purposes. You agree not to:</p>
          <ul className="list-disc list-inside space-y-1.5 pl-2">
            <li>Use the Service to harass, target, or discriminate against individuals based on their geographic location</li>
            <li>Attempt to reverse-engineer, scrape, or extract data from the Service in bulk beyond normal browser usage</li>
            <li>Use the Service to identify or track specific individuals without their consent</li>
            <li>Circumvent rate limits or attempt to overload the Service</li>
            <li>Use the Service for any unlawful purpose under applicable law</li>
          </ul>
          <p>
            The geographic data displayed is derived from public, self-declared GitHub profile information. It is aggregate and
            approximate. Using it to make decisions about individuals is inappropriate and prohibited.
          </p>
        </Section>

        <Section id="data" title="3. Data and Accuracy">
          <p>
            StarMapper displays data sourced from GitHub&apos;s public API. Location information is self-reported by GitHub users and
            may be inaccurate, outdated, or intentionally vague. We make no representation as to the accuracy of any geographic data
            displayed.
          </p>
          <p>
            We are not affiliated with GitHub, Inc. GitHub® is a trademark of GitHub, Inc.
          </p>
        </Section>

        <Section id="ip" title="4. Intellectual Property">
          <p>
            StarMapper is open-source software licensed under the{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              GNU Affero General Public License v3.0 (AGPL-3.0)
            </a>
            . The source code is available on{" "}
            <a
              href="https://github.com/FlorianBruniaux"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              GitHub
            </a>
            .
          </p>
          <p>
            The StarMapper name, logo, and visual design are the property of Florian Bruniaux and are not covered by the AGPL licence.
          </p>
        </Section>

        <Section id="disclaimer" title="5. Disclaimer of Warranties">
          <p>
            The Service is provided <strong className="text-foreground">&quot;as is&quot;</strong> and{" "}
            <strong className="text-foreground">&quot;as available&quot;</strong>, without warranty of any kind, express or implied. We do
            not guarantee uninterrupted availability, data completeness, or fitness for any particular purpose.
          </p>
          <p>
            We may modify, suspend, or discontinue the Service at any time without notice. We will not be liable for any loss or
            damage arising from such changes.
          </p>
        </Section>

        <Section id="liability" title="6. Limitation of Liability">
          <p>
            To the maximum extent permitted by applicable law, Florian Bruniaux shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from your use of the Service, including but not limited to loss of
            data, loss of profits, or reputational harm.
          </p>
          <p>
            Our total liability, if any, shall not exceed €100.
          </p>
        </Section>

        <Section id="law" title="7. Governing Law and Jurisdiction">
          <p>
            These Terms are governed by <strong className="text-foreground">French law</strong>. Any dispute arising from the use of
            StarMapper shall be subject to the exclusive jurisdiction of the competent courts of France.
          </p>
          <p>
            For data protection matters, the supervisory authority is the CNIL (Commission Nationale de l&apos;Informatique et des
            Libertés).
          </p>
        </Section>

        <Section id="contact" title="8. Contact">
          <p>
            For any question regarding these Terms, contact us at{" "}
            <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
              florian@bruniaux.com
            </a>
            .
          </p>
        </Section>

        {/* Footer nav */}
        <div className="border-t border-border-subtle pt-8 flex flex-wrap gap-4 text-xs text-muted-subtle">
          <Link href="/" className="hover:text-muted transition-colors">StarMapper</Link>
          <Link href="/privacy" className="hover:text-muted transition-colors">Privacy Policy</Link>
          <Link href="/legal" className="hover:text-muted transition-colors">Legal</Link>
          <a href="mailto:florian@bruniaux.com" className="hover:text-muted transition-colors">
            florian@bruniaux.com
          </a>
        </div>

      </div>
    </div>
  );
}
