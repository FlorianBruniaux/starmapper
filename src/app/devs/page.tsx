// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import type { LanguageListData } from "@/app/api/devs/route";

export default function DevsHubPage() {
  const [data, setData] = useState<LanguageListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/devs", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json() as LanguageListData;
        setData(json);
      })
      .catch((e) => {
        if (e.name !== "AbortError") console.error("[devs/hub] fetch error:", e);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.languages;
    const q = search.toLowerCase();
    return data.languages.filter((l) => l.name.toLowerCase().includes(q));
  }, [data, search]);

  const totalMapped = useMemo(
    () => data?.languages.reduce((acc, l) => acc + l.count, 0) ?? 0,
    [data],
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        innerMaxWidth="max-w-6xl"
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 lg:px-6 pt-20 pb-12">

        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Developer maps</h1>
          <p className="text-muted mt-2 text-sm max-w-xl">
            Explore where developers are located, by programming language. Each map shows
            the geographic distribution of GitHub users who list that language in their profile.
          </p>
          {!loading && totalMapped > 0 && (
            <p className="text-muted-subtle text-xs mt-3 tabular-nums">
              {totalMapped.toLocaleString()} developers mapped across {data?.languages.length ?? 0} languages
            </p>
          )}
        </div>

        {/* Search */}
        {(loading || (data && data.languages.length > 0)) && (
          <div className="mb-6 max-w-sm">
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
                className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm
                           text-foreground placeholder:text-muted-subtle
                           focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue
                           transition-colors"
              />
            </div>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-xl bg-surface border border-border animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            {search ? (
              <>
                <p className="text-foreground font-medium">No results for &ldquo;{search}&rdquo;</p>
                <button
                  onClick={() => setSearch("")}
                  className="text-accent-blue text-sm hover:underline"
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="text-foreground font-medium">No languages tracked yet</p>
                <p className="text-muted text-sm">Backfill is in progress — check back soon.</p>
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
      </main>

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
