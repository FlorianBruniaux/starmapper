// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { countryFlag, LANGUAGE_COLOR } from "@/lib/devs-display";
import type { LanguageListData, CountryListData } from "@/lib/devs-query";

type Tab = "countries" | "languages";

type Props = {
  initialLanguages: LanguageListData | null;
  initialCountries: CountryListData | null;
};

export const DevsClient = ({ initialLanguages, initialCountries }: Props) => {
  const [tab, setTab] = useState<Tab>("countries");
  const [search, setSearch] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getStoredToken());

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  const handleTabChange = useCallback((next: Tab) => {
    setTab(next);
    setSearch("");
  }, []);

  const filteredLanguages = useMemo(() => {
    if (!initialLanguages) return [];
    if (!search.trim()) return initialLanguages.languages;
    const q = search.toLowerCase();
    return initialLanguages.languages.filter((l) => l.name.toLowerCase().includes(q));
  }, [initialLanguages, search]);

  const filteredCountries = useMemo(() => {
    if (!initialCountries) return [];
    if (!search.trim()) return initialCountries.countries;
    const q = search.toLowerCase();
    return initialCountries.countries.filter((c) => c.name.toLowerCase().includes(q));
  }, [initialCountries, search]);

  const totalMapped = useMemo(
    () => initialLanguages?.languages.reduce((acc, l) => acc + l.count, 0) ?? 0,
    [initialLanguages],
  );

  const countryCount = initialCountries?.countries.length ?? 0;
  const languageCount = initialLanguages?.languages.length ?? 0;

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Developer maps</h1>
          <p className="text-muted mt-2 text-sm max-w-xl">
            Explore where GitHub developers are located, by country or programming language.
          </p>
          {totalMapped > 0 && (
            <p className="text-foreground text-sm font-semibold tabular-nums mt-3">
              {totalMapped.toLocaleString()}
              <span className="text-muted font-normal"> developers mapped</span>
            </p>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center border-b border-border mb-5">
          <div className="flex items-center gap-0.5">
            {(["countries", "languages"] as Tab[]).map((t) => {
              const label = t === "countries" ? "By country" : "By language";
              const count = t === "countries" ? countryCount : languageCount;
              const active = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => handleTabChange(t)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    active
                      ? "border-accent-blue text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-normal tabular-nums ${
                        active
                          ? "bg-accent-blue/15 text-accent-blue"
                          : "bg-surface text-muted-subtle"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === "languages" && (
            <Link
              href="/devs/atlas"
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 mb-1 rounded-lg border border-border
                         text-xs text-muted hover:text-foreground hover:border-accent-blue/50
                         bg-surface hover:bg-surface-alt transition-all duration-150 group"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <ellipse cx="8" cy="8" rx="3.5" ry="6.5" />
                <line x1="1.5" y1="8" x2="14.5" y2="8" />
              </svg>
              Language Atlas
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-muted-subtle group-hover:text-muted transition-colors">
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </Link>
          )}
        </div>

        {/* Search */}
        <div className="mb-5 max-w-sm">
          <div className="relative">
            <svg
              width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-subtle pointer-events-none"
              aria-hidden="true"
            >
              <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "countries" ? "Search country…" : "Search language…"}
              aria-label={tab === "countries" ? "Search country" : "Search language"}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-8 py-2 text-sm
                         text-foreground placeholder:text-muted-subtle
                         focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue
                         transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-subtle hover:text-foreground transition-colors p-0.5 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── By country ────────────────────────────────────────────────────── */}
        {tab === "countries" && (
          <>
            {!initialCountries || filteredCountries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                {search ? (
                  <>
                    <p className="text-foreground font-medium">No country matching &ldquo;{search}&rdquo;</p>
                    <button onClick={() => setSearch("")} className="text-accent-blue text-sm hover:underline">
                      Clear search
                    </button>
                  </>
                ) : (
                  <p className="text-muted text-sm">Country data loading…</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCountries.map((country) => (
                  <Link
                    key={country.slug}
                    href={`/devs/in/${country.slug}`}
                    className="group relative flex flex-col justify-between p-5 rounded-xl
                               bg-surface border border-border
                               hover:border-accent-blue/50 hover:bg-surface-alt
                               transition-all duration-150"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl leading-none shrink-0" aria-hidden="true">
                          {countryFlag(country.name)}
                        </span>
                        <span className="text-foreground font-semibold text-base group-hover:text-accent-blue transition-colors truncate">
                          {country.name}
                        </span>
                      </div>
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
                        className="text-accent-blue/60 shrink-0" aria-hidden="true"
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
          </>
        )}

        {/* ── By language ───────────────────────────────────────────────────── */}
        {tab === "languages" && (
          <>
            {!initialLanguages || filteredLanguages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                {search ? (
                  <>
                    <p className="text-foreground font-medium">No language matching &ldquo;{search}&rdquo;</p>
                    <button onClick={() => setSearch("")} className="text-accent-blue text-sm hover:underline">
                      Clear search
                    </button>
                  </>
                ) : (
                  <p className="text-muted text-sm">No languages tracked yet.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLanguages.map((lang) => (
                  <Link
                    key={lang.slug}
                    href={`/devs/${lang.slug}`}
                    className="group relative flex flex-col justify-between p-5 rounded-xl
                               bg-surface border border-border
                               hover:border-accent-blue/50 hover:bg-surface-alt
                               transition-all duration-150"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: LANGUAGE_COLOR[lang.name] ?? "#6e7681" }}
                          aria-hidden="true"
                        />
                        <span className="text-foreground font-semibold text-base group-hover:text-accent-blue transition-colors">
                          {lang.name}
                        </span>
                      </div>
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
                        className="text-accent-blue/60 shrink-0" aria-hidden="true"
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
          </>
        )}

      </main>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
};
