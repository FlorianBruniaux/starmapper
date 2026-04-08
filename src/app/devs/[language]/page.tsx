// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { slugToLanguage, displayLanguage } from "@/lib/languages";
import type { LanguageMapData } from "@/app/api/devs/[language]/route";
import type { StargazerPoint } from "@/app/api/chunk/route";

type Props = {
  params: Promise<{ language: string }>;
};

// Convert grid cells to synthetic StargazerPoint objects for the map.
// Mirrors the pattern in src/lib/grid-to-points.ts but without topLogin.
const cellsToPoints = (data: LanguageMapData): StargazerPoint[] =>
  data.cells.map((c) => ({
    login: `${data.language}-${c.lat}-${c.lng}`,
    name: `${c.count.toLocaleString()} ${data.language} developer${c.count !== 1 ? "s" : ""}`,
    bio: `__grid__:${c.count}:`,
    company: null,
    location: null,
    followers: c.count,
    avatarUrl: "",
    lat: c.lat,
    lng: c.lng,
    starredAt: null,
    linkedinUrl: null,
  }));

export default function DevsLanguagePage({ params }: Props) {
  const [slug, setSlug] = useState<string>("");
  const [data, setData] = useState<LanguageMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    params.then(({ language }) => {
      setSlug(language);
    });
  }, [params]);

  useEffect(() => {
    if (!slug) return;

    setLoading(true);
    setNotFound(false);

    fetch(`/api/devs/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as LanguageMapData;
        setData(json);
      })
      .catch((err) => {
        console.error("[devs] fetch error:", err);
        // Don't show 404 for server errors — keep loading state on transient failures
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const points = useMemo(() => (data ? cellsToPoints(data) : []), [data]);

  const canonicalName = slug ? (slugToLanguage(slug) ?? slug) : "";
  const displayName = displayLanguage(canonicalName);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background text-foreground">
        <p className="text-muted text-sm">Language not found: <code className="text-foreground">{slug}</code></p>
        <Link href="/" className="text-accent-blue text-sm hover:underline">← Back to StarMapper</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Link href="/" className="text-muted hover:text-foreground transition-colors text-sm">
          ← StarMapper
        </Link>
        <span className="text-border">|</span>
        <h1 className="text-sm font-semibold text-foreground">
          {loading ? "Loading…" : (
            <>
              <span className="text-accent-blue">{displayName}</span>
              {" developers"}
              {data && data.totalMapped > 0 && (
                <span className="text-muted font-normal ml-2">
                  — {data.totalMapped.toLocaleString()} mapped
                </span>
              )}
            </>
          )}
        </h1>
      </div>

      {/* Main: map + sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-subtle text-sm bg-surface-alt">
              Loading map…
            </div>
          ) : points.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted text-sm bg-surface-alt">
              <p>No data yet for <strong className="text-foreground">{displayName}</strong>.</p>
              <p className="text-muted-subtle text-xs">Backfill in progress — check back soon.</p>
            </div>
          ) : (
            <StargazerMapDynamic points={points} />
          )}
        </div>

        {/* Sidebar — top countries */}
        {data && data.topCountries.length > 0 && (
          <div className="w-56 shrink-0 border-l border-border overflow-y-auto bg-surface">
            <div className="p-3 border-b border-border">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Top countries</p>
            </div>
            <ul className="divide-y divide-border-subtle">
              {data.topCountries.map((c) => (
                <li key={c.country} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-foreground truncate mr-2">{c.country}</span>
                  <span className="text-muted shrink-0">{c.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
