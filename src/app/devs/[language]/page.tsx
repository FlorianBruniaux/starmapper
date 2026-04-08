// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { LanguageSwitcher } from "@/components/devs/language-switcher";
import { slugToLanguage, displayLanguage } from "@/lib/languages";
import type { LanguageMapData } from "@/app/api/devs/[language]/route";
import type { LanguageListData } from "@/app/api/devs/route";
import type { LanguageOption } from "@/components/devs/language-switcher";
import type { StargazerPoint } from "@/app/api/chunk/route";

type Props = {
  params: Promise<{ language: string }>;
};

// Convert grid cells to synthetic StargazerPoint objects for the map.
// Mirrors the pattern in src/lib/grid-to-points.ts but without topLogin.
const cellsToPoints = (data: LanguageMapData): StargazerPoint[] =>
  data.cells.map((c) => ({
    login: c.topLogin,
    name: `${c.count.toLocaleString()} ${data.language} developer${c.count !== 1 ? "s" : ""}`,
    bio: `__grid__:${c.count}:${c.topLogin}`,
    company: null,
    location: null,
    followers: c.count,
    avatarUrl: `https://github.com/${c.topLogin}.png`,
    lat: c.lat,
    lng: c.lng,
    starredAt: null,
    linkedinUrl: null,
  }));

export default function DevsLanguagePage({ params }: Props) {
  const router = useRouter();
  const [slug, setSlug] = useState<string>("");
  const [data, setData] = useState<LanguageMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Language switcher state
  const [langOptions, setLangOptions] = useState<LanguageOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  // Resolve the dynamic slug from Next.js params (async in App Router)
  useEffect(() => {
    params.then(({ language }) => {
      setSlug(language);
    });
  }, [params]);

  // Fetch the language list once for the switcher
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/devs", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json() as LanguageListData;
        setLangOptions(json.languages);
      })
      .catch((e) => {
        if (e.name !== "AbortError") console.error("[devs] options fetch error:", e);
      })
      .finally(() => setOptionsLoading(false));
    return () => ctrl.abort();
  }, []);

  // Fetch the map data for the current language
  useEffect(() => {
    if (!slug) return;

    setLoading(true);
    setNotFound(false);
    setData(null);

    const ctrl = new AbortController();
    fetch(`/api/devs/${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as LanguageMapData;
        setData(json);
      })
      .catch((e) => {
        if (e.name !== "AbortError") console.error("[devs] fetch error:", e);
        // Don't show 404 for server errors — keep loading state on transient failures
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [slug]);

  const handleLanguageSelect = useCallback((newSlug: string) => {
    router.push(`/devs/${newSlug}`);
  }, [router]);

  const points = useMemo(() => (data ? cellsToPoints(data) : []), [data]);

  const canonicalName = slug ? (slugToLanguage(slug) ?? slug) : "";
  const displayName = displayLanguage(canonicalName);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-background text-foreground px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="size-12 rounded-full bg-surface flex items-center justify-center border border-border">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-muted-subtle" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <p className="text-foreground font-semibold">Language not found</p>
          <p className="text-muted text-sm">
            <code className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-xs">
              {slug}
            </code>
            {" "}doesn&apos;t match any tracked language.
          </p>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-accent-blue text-sm hover:underline"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.81 7.25h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06z"/>
          </svg>
          Back to StarMapper
        </Link>
      </div>
    );
  }

  // Top countries max value for proportional bars
  const maxCountryCount = data && data.topCountries.length > 0 ? data.topCountries[0].count : 1;

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0 min-w-0 bg-surface">
        {/* Back link */}
        <Link
          href="/"
          className="flex items-center gap-1 text-muted hover:text-foreground transition-colors text-xs shrink-0"
          aria-label="Back to StarMapper"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.81 7.25h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06z"/>
          </svg>
          <span className="hidden sm:inline font-medium">StarMapper</span>
        </Link>

        {/* Divider */}
        <span className="text-border-subtle shrink-0 select-none" aria-hidden="true">/</span>

        {/* Page identity */}
        <h1
          className="flex items-center gap-2 min-w-0 flex-1"
          aria-live="polite"
        >
          {loading && !displayName ? (
            <span className="h-7 w-32 bg-surface-alt rounded animate-pulse" />
          ) : (
            <>
              <LanguageSwitcher
                currentSlug={slug}
                currentName={displayName || "…"}
                options={langOptions}
                loading={optionsLoading}
                onSelect={handleLanguageSelect}
              />
              <span className="text-muted text-sm font-normal shrink-0">developers</span>
            </>
          )}
        </h1>

        {/* Mapped count badge — right-aligned */}
        {data && data.totalMapped > 0 && (
          <div
            className="flex items-center gap-1.5 shrink-0 bg-accent-blue/10 border border-accent-blue/20
                        text-accent-blue text-xs font-medium px-2.5 py-1 rounded-full"
            aria-label={`${data.totalMapped.toLocaleString()} developers mapped`}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm.25 7.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8.25 7.5zm0-3a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/>
            </svg>
            <span className="hidden sm:inline">
              {data.totalMapped.toLocaleString()} mapped
            </span>
            <span className="sm:hidden">
              {data.totalMapped >= 1000
                ? `${(data.totalMapped / 1000).toFixed(1)}k`
                : data.totalMapped}
            </span>
          </div>
        )}
        {loading && (
          <span className="h-6 w-24 bg-surface-alt rounded-full animate-pulse shrink-0" />
        )}
      </header>

      {/* ── Main: map + sidebar ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 bg-surface-alt">
              {/* Animated globe placeholder */}
              <div className="relative size-16">
                <div className="absolute inset-0 rounded-full border-2 border-border animate-pulse" />
                <div className="absolute inset-2 rounded-full border border-border-subtle animate-pulse
                                [animation-delay:150ms]" />
                <svg
                  width="32" height="32" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
                  strokeLinejoin="round"
                  className="absolute inset-0 m-auto text-muted-subtle"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-foreground text-sm font-medium">Loading map…</p>
                <p className="text-muted-subtle text-xs">Fetching developer locations</p>
              </div>
            </div>
          ) : points.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5 bg-surface-alt px-6 text-center">
              <div className="size-14 rounded-full bg-surface flex items-center justify-center border border-border">
                <svg
                  width="24" height="24" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                  strokeLinejoin="round" className="text-muted-subtle" aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-foreground font-semibold">
                  No data yet for{" "}
                  <span className="text-accent-blue">{displayName}</span>
                </p>
                <p className="text-muted text-sm">
                  Backfill is in progress — check back soon.
                </p>
              </div>
              <Link
                href="/"
                className="text-accent-blue text-sm hover:underline"
              >
                Explore other languages
              </Link>
            </div>
          ) : (
            <StargazerMapDynamic points={points} />
          )}
        </div>

        {/* Sidebar — top countries */}
        {data && data.topCountries.length > 0 && (
          <aside
            className="w-56 shrink-0 border-l border-border overflow-y-auto bg-surface flex flex-col"
            aria-label="Top countries"
          >
            {/* Sidebar header */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <p className="text-xs font-semibold text-muted uppercase tracking-widest">
                Top countries
              </p>
            </div>

            {/* Country list */}
            <ul className="flex-1 py-1" role="list">
              {data.topCountries.map((c, index) => {
                const pct = Math.round((c.count / maxCountryCount) * 100);
                return (
                  <li key={c.country} className="group px-3 py-2">
                    {/* Row: rank + name + count */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-muted-subtle text-2xs font-mono w-4 text-right shrink-0">
                        {index + 1}
                      </span>
                      <span className="text-foreground text-xs truncate flex-1 group-hover:text-accent-blue transition-colors">
                        {c.country}
                      </span>
                      <span className="text-muted text-xs shrink-0 tabular-nums">
                        {c.count.toLocaleString()}
                      </span>
                    </div>
                    {/* Proportional bar */}
                    <div className="ml-6 h-0.5 rounded-full bg-border-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent-blue/40 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Footer: total */}
            {data.totalMapped > 0 && (
              <div className="px-4 py-3 border-t border-border shrink-0">
                <p className="text-muted-subtle text-2xs uppercase tracking-widest">
                  Total mapped
                </p>
                <p className="text-foreground text-sm font-semibold tabular-nums mt-0.5">
                  {data.totalMapped.toLocaleString()}
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
