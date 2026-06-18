// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import type { LanguageListData, CountryListData } from "@/lib/devs-query";

type Props = {
  initialLanguages: LanguageListData | null;
  initialCountries: CountryListData | null;
};

export const DevsClient = ({ initialLanguages, initialCountries }: Props) => {
  const [search, setSearch] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getStoredToken());

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  const filtered = useMemo(() => {
    if (!initialLanguages) return [];
    if (!search.trim()) return initialLanguages.languages;
    const q = search.toLowerCase();
    return initialLanguages.languages.filter((l) => l.name.toLowerCase().includes(q));
  }, [initialLanguages, search]);

  const totalMapped = useMemo(
    () => initialLanguages?.languages.reduce((acc, l) => acc + l.count, 0) ?? 0,
    [initialLanguages],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        innerMaxWidth="max-w-7xl"
      />

      <main id="main" className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 pt-20 pb-12">

        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-foreground">Developer maps</h1>
          <p className="text-muted mt-2 text-sm max-w-xl">
            Explore where GitHub developers are located, by programming language or country.
            Each map shows the geographic distribution of developers who list that language
            or country in their profile.
          </p>
          {totalMapped > 0 && (
            <p className="text-muted-subtle text-xs mt-3 tabular-nums">
              {totalMapped.toLocaleString()} developers mapped
            </p>
          )}
        </div>

        {/* ── By language ───────────────────────────────────────────────────── */}
        <section aria-labelledby="section-languages" className="mb-12">
          <div className="flex items-center justify-between mb-4 gap-4">
            <div>
              <h2 id="section-languages" className="text-lg font-semibold text-foreground">
                By language
              </h2>
              <p className="text-muted-subtle text-xs mt-0.5">
                Geographic distribution per programming language
              </p>
            </div>
            <Link
              href="/devs/atlas"
              className="inline-flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg border border-border
                         text-xs text-muted hover:text-foreground hover:border-accent-blue/50
                         bg-surface hover:bg-surface-alt transition-all duration-150 group"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="shrink-0">
                <circle cx="8" cy="8" r="6.5" />
                <ellipse cx="8" cy="8" rx="3.5" ry="6.5" />
                <line x1="1.5" y1="8" x2="14.5" y2="8" />
              </svg>
              Language Atlas
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-muted-subtle group-hover:text-muted transition-colors">
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </Link>
          </div>

          {/* Search */}
          {initialLanguages && initialLanguages.languages.length > 0 && (
            <div className="mb-4 max-w-sm">
              <div className="relative">
                <svg
                  width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-subtle"
                  aria-hidden="true"
                >
                  <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search language…"
                  aria-label="Search language"
                  className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm
                             text-foreground placeholder:text-muted-subtle
                             focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue
                             transition-colors"
                />
              </div>
            </div>
          )}

          {!initialLanguages ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <p className="text-foreground font-medium">No languages tracked yet</p>
              <p className="text-muted text-sm">Backfill is in progress. Check back soon.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              {search ? (
                <>
                  <p className="text-foreground font-medium">No results for &ldquo;{search}&rdquo;</p>
                  <button onClick={() => setSearch("")} className="text-accent-blue text-sm hover:underline">
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <p className="text-foreground font-medium">No languages tracked yet</p>
                  <p className="text-muted text-sm">Backfill is in progress. Check back soon.</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((lang) => (
                <Link
                  key={lang.slug}
                  href={`/devs/${lang.slug}`}
                  className="group relative flex flex-col justify-between p-5 rounded-xl
                             bg-surface border border-border
                             hover:border-accent-blue/50 hover:bg-surface-alt
                             transition-all duration-150"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-foreground font-semibold text-base group-hover:text-accent-blue transition-colors">
                      {lang.name}
                    </span>
                    <svg
                      width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
                      className="text-muted-subtle group-hover:text-accent-blue mt-0.5 shrink-0 transition-colors"
                      aria-hidden="true"
                    >
                      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <svg
                      width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
                      className="text-accent-blue/60" aria-hidden="true"
                    >
                      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                    </svg>
                    <span className="text-muted text-xs tabular-nums">
                      {lang.count.toLocaleString()} developers
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── By country ────────────────────────────────────────────────────── */}
        <section aria-labelledby="section-countries">
          <div className="mb-4">
            <h2 id="section-countries" className="text-lg font-semibold text-foreground">
              By country
            </h2>
            <p className="text-muted-subtle text-xs mt-0.5">
              Top countries by number of mapped GitHub developers
            </p>
          </div>

          {!initialCountries || initialCountries.countries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <p className="text-foreground font-medium">Country data loading…</p>
              <p className="text-muted text-sm">Check back soon.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {initialCountries.countries.map((country) => (
                <Link
                  key={country.slug}
                  href={`/devs/in/${country.slug}`}
                  className="group relative flex flex-col justify-between p-5 rounded-xl
                             bg-surface border border-border
                             hover:border-accent-blue/50 hover:bg-surface-alt
                             transition-all duration-150"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-foreground font-semibold text-base group-hover:text-accent-blue transition-colors">
                      {country.name}
                    </span>
                    <svg
                      width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
                      className="text-muted-subtle group-hover:text-accent-blue mt-0.5 shrink-0 transition-colors"
                      aria-hidden="true"
                    >
                      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <svg
                      width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
                      className="text-accent-blue/60" aria-hidden="true"
                    >
                      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                    </svg>
                    <span className="text-muted text-xs tabular-nums">
                      {country.count.toLocaleString()} developers
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

      </main>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
};
