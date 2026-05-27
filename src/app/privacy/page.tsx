// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — StarMapper",
  description: "How StarMapper collects, stores, and processes public GitHub stargazer data. Your GDPR rights and how to exercise them.",
  robots: { index: true, follow: true },
};

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="mb-10">
    <h2 className="text-base font-semibold text-foreground mb-3 pb-2 border-b border-border-subtle">{title}</h2>
    <div className="space-y-3 text-sm text-muted leading-relaxed">{children}</div>
  </section>
);

export default function PrivacyPage() {
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

        <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-xs text-muted-subtle mb-10">Last revised: 18 May 2026</p>

        {/* 1. Controller */}
        <Section id="controller" title="1. Data Controller">
          <p>
            StarMapper is operated by <strong className="text-foreground">Florian Bruniaux</strong>, an individual based in France.
          </p>
          <p>
            Contact for privacy matters:{" "}
            <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
              florian@bruniaux.com
            </a>
          </p>
          <p>
            As a French operator, StarMapper falls under the jurisdiction of the CNIL (Commission Nationale de l&apos;Informatique et des Libertés)
            and is subject to the General Data Protection Regulation (EU) 2016/679 (GDPR).
          </p>
        </Section>

        {/* 2. Data collected */}
        <Section id="data" title="2. What Data We Collect">
          <p>
            StarMapper accesses publicly available data from the GitHub API for any repository you choose to scan. For each person who
            starred that repository, we collect:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2">
            <li><strong className="text-foreground">GitHub username (login)</strong>: a public identifier</li>
            <li><strong className="text-foreground">Display name</strong>: optional, publicly visible on GitHub profiles</li>
            <li><strong className="text-foreground">Self-declared location</strong>: free-text field on the GitHub profile (e.g. &quot;Paris, France&quot;)</li>
            <li><strong className="text-foreground">Follower count</strong>: publicly visible metric</li>
            <li><strong className="text-foreground">Star date</strong>: when the user starred the repository</li>
            <li>
              <strong className="text-foreground">Account creation date</strong>: publicly visible on GitHub profiles; used as one signal
              in our organic integrity heuristic to assess the authenticity of a repository&apos;s stargazer base
            </li>
            <li>
              <strong className="text-foreground">Geocoded coordinates (lat/lng)</strong>: derived from the location field above, via
              third-party geocoding services, to place the user on the map
            </li>
          </ul>
          <p>
            We do not collect email addresses, private repository data, or any information not publicly visible on GitHub profiles.
          </p>
        </Section>

        {/* 3. Source */}
        <Section id="source" title="3. Where the Data Comes From">
          <p>
            All data is retrieved via the <strong className="text-foreground">GitHub GraphQL and REST APIs</strong> using authenticated requests.
            We do not scrape the GitHub website (HTML). The GitHub API is the authorised programmatic channel for accessing public user data,
            as described in GitHub&apos;s Terms of Service and API documentation.
          </p>
          <p>
            Location text is then sent to third-party geocoding services (Jawg Places, Geoapify, and Nominatim) to resolve
            coordinates. Results are cached in our shared geocoding database to avoid redundant API calls.
          </p>
        </Section>

        {/* 4. Purpose */}
        <Section id="purpose" title="4. Why We Process This Data">
          <p>
            StarMapper processes this data for two purposes, both within the scope of repository analytics:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2">
            <li>
              <strong className="text-foreground">Geographic visualisation</strong>: placing stargazers on an interactive world map
              with country and city statistics, to help developers understand the reach of their open-source projects
            </li>
            <li>
              <strong className="text-foreground">Organic integrity assessment</strong>: computing a heuristic score based on publicly
              available signals (fork ratio, watcher ratio, zero-follower percentage, account creation date, release activity) to give
              maintainers a rough indicator of whether a repository&apos;s stargazer base appears authentic
            </li>
          </ul>
          <p>Data is not used for advertising, profiling, resale, or any purpose outside these two functions.</p>
        </Section>

        {/* 5. Legal basis */}
        <Section id="legal-basis" title="5. Legal Basis for Processing">
          <p>
            Processing is based on <strong className="text-foreground">Legitimate Interests</strong> (GDPR Article 6(1)(f)).
          </p>
          <p>
            <strong className="text-foreground">Our interest:</strong> providing developers with a free tool to understand the geographic reach
            of their open-source projects, using publicly available GitHub data.
          </p>
          <p>
            <strong className="text-foreground">Balancing test:</strong> all data collected is already public on GitHub; users who wish to
            control their location visibility can remove or modify the location field on their GitHub profile at any time. StarMapper displays
            data in aggregate (clusters on a map), not as searchable individual records. The processing is transparent and the tool is
            free and open-source.
          </p>
          <p>
            We have concluded that our legitimate interest is not overridden by the rights and freedoms of data subjects, given the public
            nature of the data, the aggregate display, and the availability of opt-out mechanisms described below.
          </p>
        </Section>

        {/* 6. Retention */}
        <Section id="retention" title="6. Data Retention">
          <p>
            User profile records (<em>github_user</em> table) and star event records (<em>star_event</em> table) are automatically deleted
            after <strong className="text-foreground">12 months</strong> from the date they were last fetched. A monthly automated job
            purges records older than this threshold.
          </p>
          <p>
            The geocoding cache (<em>geocache</em> table) maps location strings to coordinates and is not linked to individual users.
            It is retained indefinitely to avoid redundant API calls; it contains no personally identifiable information beyond the
            location text.
          </p>
          <p>
            Deletion request audit logs (<em>deletion_log</em> table) are retained for 3 years to demonstrate regulatory compliance.
          </p>
        </Section>

        {/* 7. Sub-processors */}
        <Section id="processors" title="7. Sub-processors and Data Recipients">
          <p>We rely on the following third-party service providers, each processing data on our behalf:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border-subtle rounded-lg overflow-hidden">
              <thead className="bg-surface-alt">
                <tr>
                  <th className="text-left px-3 py-2 text-foreground font-medium">Provider</th>
                  <th className="text-left px-3 py-2 text-foreground font-medium">Role</th>
                  <th className="text-left px-3 py-2 text-foreground font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                <tr className="bg-surface">
                  <td className="px-3 py-2">Neon (Neon, Inc.)</td>
                  <td className="px-3 py-2">Postgres database hosting</td>
                  <td className="px-3 py-2">USA (AWS us-east-1)</td>
                </tr>
                <tr className="bg-surface">
                  <td className="px-3 py-2">Vercel, Inc.</td>
                  <td className="px-3 py-2">Application hosting &amp; CDN</td>
                  <td className="px-3 py-2">USA / global edge</td>
                </tr>
                <tr className="bg-surface">
                  <td className="px-3 py-2">Jawg Maps (Jawg)</td>
                  <td className="px-3 py-2">Geocoding (primary)</td>
                  <td className="px-3 py-2">France</td>
                </tr>
                <tr className="bg-surface">
                  <td className="px-3 py-2">Geoapify GmbH</td>
                  <td className="px-3 py-2">Geocoding (fallback 1)</td>
                  <td className="px-3 py-2">Germany</td>
                </tr>
                <tr className="bg-surface">
                  <td className="px-3 py-2">Nominatim / OpenStreetMap</td>
                  <td className="px-3 py-2">Geocoding (fallback 2)</td>
                  <td className="px-3 py-2">OSM Foundation, UK</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Data transfers to providers located outside the EU (Neon, Vercel) rely on Standard Contractual Clauses (SCCs) as the
            transfer mechanism under GDPR Chapter V.
          </p>
        </Section>

        {/* 8. Cookies */}
        <Section id="cookies" title="8. Cookies and Tracking">
          <p>
            StarMapper sets <strong className="text-foreground">one technical cookie</strong>:{" "}
            <code className="bg-surface-alt px-1.5 py-0.5 rounded text-xs font-mono">sm_token</code>, used exclusively for security
            purposes (HMAC-signed request authentication). This cookie is strictly necessary for the service to function and does not
            track your browsing behaviour across sites.
          </p>
          <p>
            <strong className="text-foreground">No analytics cookies</strong>, no third-party tracking pixels, and no advertising
            identifiers are set. No cookie consent banner is required.
          </p>
          <p>
            StarMapper also stores your theme preference (<code className="bg-surface-alt px-1.5 py-0.5 rounded text-xs font-mono">starmapper:theme</code>)
            in <code className="bg-surface-alt px-1.5 py-0.5 rounded text-xs font-mono">localStorage</code>, which is not a cookie and not
            transmitted to any server.
          </p>
        </Section>

        {/* 9. Your rights */}
        <Section id="rights" title="9. Your Rights Under GDPR">
          <p>As a data subject under GDPR, you have the following rights:</p>
          <ul className="list-disc list-inside space-y-2 pl-2">
            <li>
              <strong className="text-foreground">Right of access (Art. 15)</strong>: request a copy of all data we hold about your
              GitHub account
            </li>
            <li>
              <strong className="text-foreground">Right to erasure (Art. 17)</strong>: request deletion of your data from our systems
            </li>
            <li>
              <strong className="text-foreground">Right to object (Art. 21)</strong>: object to our processing based on legitimate interests
            </li>
            <li>
              <strong className="text-foreground">Right to restriction (Art. 18)</strong>: request that we restrict processing while a
              dispute is resolved
            </li>
            <li>
              <strong className="text-foreground">Right to portability (Art. 20)</strong>: receive your data in a structured,
              machine-readable format
            </li>
          </ul>
          <p>
            To exercise any of these rights, send an email to{" "}
            <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
              florian@bruniaux.com
            </a>{" "}
            with your GitHub username and confirmation that you are the account holder. We will respond within{" "}
            <strong className="text-foreground">30 days</strong>.
          </p>
          <p>
            You also have the right to lodge a complaint with the CNIL:{" "}
            <a
              href="https://www.cnil.fr/fr/plaintes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              cnil.fr/fr/plaintes
            </a>
            .
          </p>
        </Section>

        {/* 10. How to request deletion */}
        <Section id="deletion" title="10. How to Request Data Deletion">
          <p>Send an email to{" "}
            <a href="mailto:florian@bruniaux.com" className="text-accent-blue hover:underline">
              florian@bruniaux.com
            </a>
            {" "}with:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2">
            <li>Subject: <strong className="text-foreground">GDPR Data Deletion Request</strong></li>
            <li>Your GitHub username</li>
            <li>Confirmation that you are the account holder</li>
          </ul>
          <p>We will delete your profile data, star events, and recalculate any affected aggregations. You will receive a confirmation
            email once the deletion is complete, within 30 days of your request.</p>
          <p>
            <strong className="text-foreground">Simpler alternative:</strong> remove or change your location field in your{" "}
            <a
              href="https://github.com/settings/profile"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              GitHub profile settings
            </a>
            . The next scan of any repository you&apos;ve starred will use your updated (or absent) location.
          </p>
        </Section>

        {/* 11. Changes */}
        <Section id="changes" title="11. Changes to This Policy">
          <p>
            If we make material changes to how we process your data, we will update the &quot;Last revised&quot; date at the top of this page.
            Continued use of StarMapper after changes are posted constitutes acceptance of the updated policy.
          </p>
        </Section>

        {/* Footer nav */}
        <div className="border-t border-border-subtle pt-8 flex flex-wrap gap-4 text-xs text-muted-subtle">
          <Link href="/" className="hover:text-muted transition-colors">StarMapper</Link>
          <Link href="/terms" className="hover:text-muted transition-colors">Terms of Service</Link>
          <Link href="/legal" className="hover:text-muted transition-colors">Legal</Link>
          <a href="mailto:florian@bruniaux.com" className="hover:text-muted transition-colors">
            florian@bruniaux.com
          </a>
        </div>

      </div>
    </div>
  );
}
