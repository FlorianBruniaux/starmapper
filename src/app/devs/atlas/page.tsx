// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { LanguageChoroplethDynamic } from "@/components/map/language-choropleth-dynamic";
import { LANGUAGE_COLORS, NO_DATA_COLOR, langColor } from "@/lib/language-colors";
import { languageToSlug } from "@/lib/languages";
import type { AtlasDominantData, AtlasCountry } from "@/app/api/devs/atlas/route";
import type { SelectedCountry } from "@/components/map/language-choropleth";

const MAX_LEGEND_LANGS = 12;

const computeLegend = (countries: AtlasCountry[]) => {
  const freq = new Map<string, number>();
  for (const c of countries) {
    if (c.topLang) freq.set(c.topLang, (freq.get(c.topLang) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LEGEND_LANGS)
    .map(([lang, count]) => ({ lang, count, color: LANGUAGE_COLORS[lang] ?? "#8b949e" }));
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
};

// ─── Color utility ────────────────────────────────────────────────────────────

const isLightColor = (hex: string): boolean => {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
};

// ─── Country Modal ────────────────────────────────────────────────────────────

const CountryModal = ({
  selected,
  onClose,
}: {
  selected: SelectedCountry;
  onClose: () => void;
}) => {
  const pct = selected.total > 0 ? Math.round((selected.topCnt / selected.total) * 100) : 0;
  const color = langColor(selected.topLang);
  const slug = languageToSlug(selected.topLang);
  const isLight = isLightColor(color);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="country-modal-title"
        className="relative z-10 w-full max-w-sm bg-surface border border-border rounded-2xl
                   shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header strip with lang color */}
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />

        <div className="p-5">
          {/* Country name + close */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 id="country-modal-title" className="text-lg font-bold text-foreground leading-tight">{selected.country}</h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="inline-block rounded-full shrink-0"
                  style={{ width: 8, height: 8, backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="text-sm text-muted">{selected.topLang} most popular</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-subtle hover:text-foreground hover:bg-surface-alt
                         transition-colors shrink-0 -mt-0.5"
              aria-label="Close country details"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <div className="bg-surface-alt border border-border-subtle rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-foreground tabular-nums">
                {selected.total.toLocaleString()}
              </p>
              <p className="text-xs text-muted-subtle mt-0.5">developers</p>
            </div>
            <div className="bg-surface-alt border border-border-subtle rounded-xl p-3 text-center">
              <p
                className="text-lg font-bold tabular-nums"
                style={{ color: isLight ? "var(--color-foreground)" : color }}
              >
                {pct}%
              </p>
              <p className="text-xs text-muted-subtle mt-0.5">favor {selected.topLang}</p>
            </div>
            <div className="bg-surface-alt border border-border-subtle rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-foreground tabular-nums">
                {selected.topCnt.toLocaleString()}
              </p>
              <p className="text-xs text-muted-subtle mt-0.5">{selected.topLang} devs</p>
            </div>
          </div>

          {/* CTA */}
          <Link
            href={`/devs/${slug}`}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                       text-sm font-semibold transition-opacity hover:opacity-90
                       ${isLight ? "text-black" : "text-white"}`}
            style={{ backgroundColor: color }}
            onClick={onClose}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
            </svg>
            See {selected.topLang} developer map
          </Link>
        </div>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LanguageAtlasPage() {
  const [data, setData] = useState<AtlasDominantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<SelectedCountry | null>(null);

  useEffect(() => {
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/devs/atlas", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json() as AtlasDominantData;
        setData(json);
      })
      .catch((e) => {
        if (e.name !== "AbortError") console.error("[devs/atlas] fetch error:", e);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  const handleCountryClick = useCallback((selected: SelectedCountry) => {
    setSelectedCountry(selected);
  }, []);

  const legend = useMemo(() => (data ? computeLegend(data.countries) : []), [data]);

  const countries = data?.countries ?? [];
  const totalCountries = countries.length;

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
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 mb-4 list-none p-0 m-0">
              <li>
                <Link href="/devs" className="text-xs text-muted-subtle hover:text-muted transition-colors">
                  Developer maps
                </Link>
              </li>
              <li aria-hidden="true" className="text-muted-subtle text-xs">/</li>
              <li>
                <span className="text-xs text-muted" aria-current="page">Language Atlas</span>
              </li>
            </ol>
          </nav>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Language Atlas</h1>
              <p className="text-muted text-sm mt-2 max-w-lg leading-relaxed">
                Which programming language developers gravitate toward in each country, based on
                repos starred and contributed to. Click a country to explore.
              </p>
            </div>

            {!loading && totalCountries > 0 && (
              <div className="flex items-center gap-3 shrink-0 sm:pt-1">
                <div className="flex items-center gap-2 bg-surface border border-border-subtle rounded-lg px-3 py-2">
                  <span className="text-lg font-bold text-foreground tabular-nums">{totalCountries}</span>
                  <span className="text-xs text-muted leading-tight">countries<br />mapped</span>
                </div>
                {data?.meta.minDevsThreshold && (
                  <div className="flex items-center gap-2 bg-surface border border-border-subtle rounded-lg px-3 py-2">
                    <span className="text-lg font-bold text-foreground tabular-nums">{data.meta.minDevsThreshold}</span>
                    <span className="text-xs text-muted leading-tight">devs min<br />threshold</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Beta notice — remove once backfill is complete */}
        <div className="flex items-start gap-3 bg-accent-orange/8 border border-accent-orange/20 rounded-xl px-4 py-3 mb-5 text-sm">
          <svg className="text-accent-orange shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
          </svg>
          <p className="text-muted leading-relaxed">
            <span className="text-foreground font-medium">Early preview.</span>{" "}
            Language data is still being collected — only a sample of developers is represented.
            The map will fill in progressively over the next few days.
          </p>
        </div>

        {/* Map */}
        <div
          className="relative rounded-xl overflow-hidden border border-border shadow-lg shadow-black/20"
          style={{ height: "62vh", minHeight: 340 }}
        >
          {loading ? (
            <div className="w-full h-full bg-surface animate-pulse motion-reduce:animate-none flex items-center justify-center">
              <span className="text-muted-subtle text-sm">Loading atlas…</span>
            </div>
          ) : totalCountries === 0 ? (
            <div className="w-full h-full bg-surface flex flex-col items-center justify-center gap-4">
              <svg className="text-muted-subtle" width="48" height="48" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <div className="text-center">
                <p className="text-foreground font-medium">Atlas not available yet</p>
                <p className="text-muted text-sm mt-1 max-w-xs leading-relaxed">
                  The language backfill is in progress. The map will appear once enough data has been collected.
                </p>
              </div>
              <p className="text-xs text-muted-subtle">Refreshes daily</p>
            </div>
          ) : (
            <LanguageChoroplethDynamic countries={countries} onCountryClick={handleCountryClick} />
          )}
        </div>

        {/* Legend + metadata */}
        {!loading && legend.length > 0 && (
          <div className="mt-3 bg-surface border border-border-subtle rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-y-3">
              <div className="flex flex-wrap gap-x-5 gap-y-2.5">
                {legend.map(({ lang, color }) => (
                  <Link key={lang} href={`/devs/${languageToSlug(lang)}`}
                    className="flex items-center gap-2 group" title={`See all ${lang} developers`}>
                    <span className="inline-block rounded-full shrink-0"
                      style={{ width: 12, height: 12, backgroundColor: color }} aria-hidden="true" />
                    <span className="text-xs text-muted group-hover:text-foreground transition-colors">{lang}</span>
                  </Link>
                ))}
                <div className="flex items-center gap-2">
                  <span className="inline-block rounded-full shrink-0"
                    style={{ width: 12, height: 12, backgroundColor: NO_DATA_COLOR, border: "1px solid rgba(139,148,158,0.3)" }}
                    aria-hidden="true" />
                  <span className="text-xs text-muted-subtle">No data</span>
                </div>
              </div>
              <p className="text-xs text-muted-subtle tabular-nums shrink-0">
                Updated {data ? formatDate(data.meta.generatedAt) : "—"}
              </p>
            </div>
          </div>
        )}

      </main>

      {/* Country modal */}
      {selectedCountry && (
        <CountryModal
          selected={selectedCountry}
          onClose={() => setSelectedCountry(null)}
        />
      )}

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
