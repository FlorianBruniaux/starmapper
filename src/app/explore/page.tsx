// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/header";
import { CommandSearch } from "@/components/command-search";
import { Footer } from "@/components/footer";
import { StatsList } from "@/components/stats-list";
import { FilterCombobox } from "@/components/filter-combobox";
import { CountryChoroplethDynamic } from "@/components/map/country-choropleth-dynamic";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { useFetch } from "@/hooks/use-fetch";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { gridToPoints } from "@/lib/grid-to-points";
import type { ExploreSummary } from "@/app/api/explore/route";
import type { TopUsersResponse } from "@/app/api/explore/top/route";
import type { PowerResponse } from "@/app/api/explore/power/route";
import type { CompaniesResponse } from "@/app/api/explore/companies/route";
import type { LocationsResponse } from "@/app/api/explore/locations/route";
import type { GlobalMapData } from "@/app/api/explore/global-map/route";
import type { UserReposResponse } from "@/app/api/explore/user-repos/route";

type Tab = "top" | "power" | "companies" | "countries" | "cities";

const PAGE_SIZE = 30;

const buildUrl = (
  base: string,
  params: Record<string, string | number>,
): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v !== undefined) sp.set(k, String(v));
  }
  return `${base}?${sp.toString()}`;
};

// ---------- Pagination strip ----------
const Pagination = ({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) => {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-5 pt-4 border-t border-border-subtle">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="text-xs text-muted hover:text-foreground disabled:opacity-30 transition-colors px-2 py-1 rounded"
      >
        ← Prev
      </button>
      <span className="text-xs text-muted-subtle tabular-nums">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="text-xs text-muted hover:text-foreground disabled:opacity-30 transition-colors px-2 py-1 rounded"
      >
        Next →
      </button>
    </div>
  );
};

// ---------- Repos badge + popover ----------
const ReposBadge = ({ login, count }: { login: string; count: number }) => {
  const [open, setOpen] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(count);
  const ref = useRef<HTMLDivElement>(null);
  const url = open ? `/api/explore/user-repos?login=${encodeURIComponent(login)}` : null;
  const { data, loading } = useFetch<UserReposResponse>(url);

  // Update count once we have the real value from GitHub
  useEffect(() => {
    if (data?.totalRepos && data.totalRepos > resolvedCount) {
      setResolvedCount(data.totalRepos);
    }
  }, [data, resolvedCount]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-2xs px-1.5 py-px rounded border transition-colors tabular-nums ${
          open
            ? "border-accent-blue text-accent-blue bg-accent-blue/10"
            : "border-border-subtle text-muted hover:text-foreground hover:border-border"
        }`}
        title="View GitHub repos"
      >
        {resolvedCount > 0 ? `${resolvedCount} repos` : "repos"}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Top GitHub repos</span>
            <a
              href={`https://github.com/${login}?tab=repositories`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-2xs text-muted hover:text-accent-blue transition-colors"
            >
              View all →
            </a>
          </div>
          {loading && !data && (
            <div className="px-3 py-3 text-xs text-muted-subtle text-center">Loading…</div>
          )}
          {data && data.repos.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-subtle text-center">No public repos.</div>
          )}
          {data && data.repos.length > 0 && (
            <ul className="max-h-64 overflow-y-auto divide-y divide-border-subtle">
              {data.repos.map((r) => (
                <li key={r.fullName}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 px-3 py-2.5 hover:bg-surface-alt transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-foreground font-medium truncate group-hover:text-accent-blue transition-colors">
                          {r.name}
                        </span>
                        {r.language && (
                          <span className="text-2xs text-muted-subtle flex-shrink-0">{r.language}</span>
                        )}
                      </div>
                      {r.description && (
                        <div className="text-2xs text-muted truncate mt-px">{r.description}</div>
                      )}
                    </div>
                    <span className="text-2xs text-muted-subtle flex-shrink-0 tabular-nums mt-0.5">
                      ★ {(r.stars ?? 0).toLocaleString()}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ---------- Main Page ----------
const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";

export default function ExplorePage() {
  const { theme } = useTheme();
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const [tab, setTab]                     = useState<Tab>("top");
  const [selectedCountry, setCountry]     = useState("");
  const [searchInput, setSearchInput]     = useState("");
  const [search, setSearch]               = useState("");
  const [pages, setPages]                 = useState<Record<Tab, number>>({
    top: 1, power: 1, companies: 1, countries: 1, cities: 1,
  });

  // Summary (loaded once)
  const [summary, setSummary]             = useState<ExploreSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Map panel state — independent of tab selection
  const [mapMode, setMapMode]             = useState<"choropleth" | "heatmap">("choropleth");
  const [mapEverOpened, setMapEverOpened] = useState(false);
  const [heatmapEverOpened, setHeatmapEverOpened] = useState(false);

  useEffect(() => {
    fetch("/api/explore")
      .then((r) => r.ok ? r.json() as Promise<ExploreSummary> : null)
      .then((d) => { if (d) setSummary(d); })
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, []);

  // Trigger map data fetch as soon as the component mounts (map is always visible on wide screens)
  useEffect(() => {
    setMapEverOpened(true);
  }, []);

  // Debounce search input → search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset pages to 1 when filters change
  const prevFilters = useRef({ selectedCountry, search });
  useEffect(() => {
    const prev = prevFilters.current;
    if (prev.selectedCountry !== selectedCountry || prev.search !== search) {
      prevFilters.current = { selectedCountry, search };
      setPages({ top: 1, power: 1, companies: 1, countries: 1, cities: 1 });
    }
  }, [selectedCountry, search]);

  const setPage = (t: Tab, p: number) => setPages((prev) => ({ ...prev, [t]: p }));

  // Per-tab URLs — null when tab is inactive (prevents unnecessary fetches)
  const topUrl = tab === "top" ? buildUrl("/api/explore/top", {
    page: pages.top, size: PAGE_SIZE, country: selectedCountry, search,
  }) : null;

  const powerUrl = tab === "power" ? buildUrl("/api/explore/power", {
    page: pages.power, size: PAGE_SIZE,
  }) : null;

  const companiesUrl = tab === "companies" ? buildUrl("/api/explore/companies", {
    page: pages.companies, size: PAGE_SIZE, country: selectedCountry,
  }) : null;

  const countriesUrl = tab === "countries" ? buildUrl("/api/explore/locations", {
    page: pages.countries, size: PAGE_SIZE, type: "country",
  }) : null;

  const citiesUrl = tab === "cities" ? buildUrl("/api/explore/locations", {
    page: pages.cities, size: PAGE_SIZE, type: "city", country: selectedCountry,
  }) : null;

  // Map panel data — always fetched (map is persistent in the right column)
  const mapCountriesUrl = mapEverOpened
    ? buildUrl("/api/explore/locations", { type: "country", size: 50 })
    : null;
  const globalMapUrl = heatmapEverOpened ? "/api/explore/global-map" : null;

  const { data: topData,           loading: topLoading }           = useFetch<TopUsersResponse>(topUrl);
  const { data: powerData,         loading: powerLoading }         = useFetch<PowerResponse>(powerUrl);
  const { data: companiesData,     loading: companiesLoading }     = useFetch<CompaniesResponse>(companiesUrl);
  const { data: countriesData,     loading: countriesLoading }     = useFetch<LocationsResponse>(countriesUrl);
  const { data: citiesData,        loading: citiesLoading }        = useFetch<LocationsResponse>(citiesUrl);
  const { data: mapCountriesData,  loading: mapCountriesLoading }  = useFetch<LocationsResponse>(mapCountriesUrl);
  const { data: globalMapData,     loading: globalMapLoading }     = useFetch<GlobalMapData>(globalMapUrl);

  const tabLoading = {
    top: topLoading, power: powerLoading, companies: companiesLoading,
    countries: countriesLoading, cities: citiesLoading,
  }[tab];

  // Grid cells → StargazerPoints (memoized — only recomputed when data changes)
  const heatmapPoints = useMemo(
    () => (globalMapData ? gridToPoints(globalMapData.cells) : []),
    [globalMapData],
  );

  // Whether the current tab supports the country filter
  const showCountryFilter = tab !== "power" && tab !== "countries";
  // Whether the current tab supports text search
  const showSearch = tab === "top";

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    setSearchInput("");
    setSearch("");
  }, []);

  const handleChoroplethCountryClick = useCallback((country: string) => {
    setCountry(country);
    setTab("top");
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <CommandSearch />
      <Header
        sticky
        innerMaxWidth="max-w-7xl"
        nav={<span className="text-sm text-foreground font-medium" aria-current="page">Leaderboard</span>}
      />

      <main id="main" className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 pt-6 pb-8">

        {/* Page title */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-foreground">Stargazer Intelligence</h1>
          <p className="text-muted text-sm mt-1">Global leaderboards across all tracked repos</p>
        </div>

        {/* Summary cards — full width */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {([
            {
              label: "Developers",
              value: summaryLoading ? "…" : (summary?.totalUsers ?? 0).toLocaleString(),
              accent: "text-foreground",
            },
            {
              label: "Tracked repos",
              value: summaryLoading ? "…" : (summary?.totalTrackedRepos ?? 0).toLocaleString(),
              accent: "text-foreground",
            },
            {
              label: "Star events",
              value: summaryLoading ? "…" : summary
                ? (summary.totalStarEvents >= 1000
                  ? `${(summary.totalStarEvents / 1000).toFixed(1)}k`
                  : summary.totalStarEvents.toString())
                : "…",
              accent: "text-accent-orange",
            },
            {
              label: "Countries",
              value: summaryLoading ? "…" : (summary?.totalCountries ?? 0).toLocaleString(),
              accent: "text-accent-green",
            },
          ] as const).map(({ label, value, accent }) => (
            <div key={label} className="bg-surface border border-border rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${accent}`}>{value}</div>
              <div className="text-xs text-muted uppercase tracking-wide mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Two-column layout: leaderboard left, map right */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">

          {/* ── LEFT COLUMN: leaderboard tabs ── */}
          <div className="w-full lg:w-96 xl:w-[440px] flex-shrink-0">
            <div className="bg-surface border border-border rounded-xl overflow-hidden">

              {/* Tab bar */}
              <div className="flex border-b border-border-subtle overflow-x-auto">
                {(["top", "power", "companies", "countries", "cities"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleTabChange(t)}
                    className={`flex-shrink-0 flex-1 py-3 text-xs font-medium transition-colors whitespace-nowrap px-2 ${
                      tab === t
                        ? "text-accent-blue border-b-2 border-accent-blue -mb-px bg-accent-blue/5"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t === "top"
                      ? "Top Stars"
                      : t === "power"
                      ? "⚡ Power"
                      : t === "companies"
                      ? "Companies"
                      : t === "countries"
                      ? "Countries"
                      : "Cities"}
                  </button>
                ))}
              </div>

              {/* Filter bar */}
              {(showCountryFilter || showSearch) && (
                <div className="flex items-center gap-2 px-5 pt-4 pb-0">
                  {showCountryFilter && summary && (
                    <FilterCombobox
                      value={selectedCountry}
                      onChange={setCountry}
                      options={summary.countryList}
                      placeholder="All countries"
                    />
                  )}
                  {showSearch && (
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search login or name…"
                      className={`flex-1 bg-background border border-border rounded text-xs text-foreground
                        placeholder:text-muted-subtle px-2 py-0.5 focus:outline-none
                        focus:ring-1 focus:ring-accent-blue/40 focus:border-accent-blue transition-colors
                        ${showCountryFilter ? "max-w-xs" : ""}`}
                    />
                  )}
                  {selectedCountry && (
                    <button
                      onClick={() => { setCountry(""); }}
                      className="text-2xs text-muted hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Tab content */}
              <div className="p-5">
                {tabLoading && !{
                  top: topData, power: powerData, companies: companiesData,
                  countries: countriesData, cities: citiesData,
                }[tab] && (
                  <div className="text-center text-muted-subtle text-sm py-12">Loading…</div>
                )}

                {/* Top Stars */}
                {tab === "top" && topData && (
                  <>
                    <div className="space-y-3">
                      {topData.items.map((u, i) => (
                        <div key={u.login} className="flex items-center gap-3">
                          <span className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">
                            {(pages.top - 1) * PAGE_SIZE + i + 1}
                          </span>
                          <img
                            src={u.avatarUrl}
                            alt=""
                            className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={`https://github.com/${u.login}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-blue text-sm font-medium hover:underline"
                              >
                                @{u.login}
                              </a>
                              {u.company && (
                                <span className="text-2xs text-muted bg-surface-alt border border-border-subtle rounded px-1.5 py-px truncate max-w-28">
                                  {u.company.replace(/^@/, "")}
                                </span>
                              )}
                            </div>
                            {u.name && u.name !== u.login && (
                              <div className="text-muted-subtle text-xs truncate">{u.name}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <ReposBadge login={u.login} count={u.publicRepos} />
                            <span className="text-muted text-xs tabular-nums">
                              {u.followers.toLocaleString()} flw
                            </span>
                          </div>
                        </div>
                      ))}
                      {topData.items.length === 0 && (
                        <div className="text-center text-muted-subtle text-sm py-12">No results.</div>
                      )}
                    </div>
                    <Pagination
                      total={topData.total}
                      page={topData.page}
                      pageSize={topData.pageSize}
                      onPage={(p) => setPage("top", p)}
                    />
                  </>
                )}

                {/* Power */}
                {tab === "power" && (
                  <>
                    <div className="flex items-start gap-2 bg-accent-orange/5 border border-accent-orange/20 rounded-lg px-3 py-2.5 mb-4">
                      <span className="text-accent-orange text-sm mt-px shrink-0">⚡</span>
                      <p className="text-xs text-muted leading-relaxed">
                        Developers who starred the most repos tracked on StarMapper. The count shows how many
                        of the{" "}
                        {(summary?.totalTrackedRepos ?? 0).toLocaleString()} scanned repos they&apos;ve starred.
                      </p>
                    </div>
                    {powerData && (
                      <>
                        {powerData.items.length === 0 && (
                          <div className="text-center text-muted-subtle text-sm py-12">
                            <div className="text-3xl mb-2">⚡</div>
                            No power stargazers yet. Appears after multiple repos are scanned.
                          </div>
                        )}
                        <div className="space-y-3">
                          {powerData.items.map((u, i) => (
                            <div key={u.login} className="flex items-center gap-3">
                              <span className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">
                                {(pages.power - 1) * PAGE_SIZE + i + 1}
                              </span>
                              <img
                                src={u.avatarUrl}
                                alt=""
                                className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border"
                              />
                              <div className="flex-1 min-w-0">
                                <a
                                  href={`https://github.com/${u.login}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent-blue text-sm font-medium hover:underline"
                                >
                                  @{u.login}
                                </a>
                                {u.name && u.name !== u.login && (
                                  <div className="text-muted-subtle text-xs truncate">{u.name}</div>
                                )}
                              </div>
                              <span
                                className="text-accent-orange text-xs flex-shrink-0 tabular-nums font-medium"
                                title={`Starred ${u.trackedRepos} tracked repos`}
                              >
                                {u.trackedRepos} starred
                              </span>
                            </div>
                          ))}
                        </div>
                        <Pagination
                          total={powerData.total}
                          page={powerData.page}
                          pageSize={powerData.pageSize}
                          onPage={(p) => setPage("power", p)}
                        />
                      </>
                    )}
                  </>
                )}

                {/* Companies */}
                {tab === "companies" && companiesData && (
                  <>
                    <div className="space-y-2">
                      {companiesData.items.length === 0 && (
                        <div className="text-center text-muted-subtle text-sm py-12">No company data yet.</div>
                      )}
                      {companiesData.items.map(([company, count], idx) => (
                        <div key={company} className="flex items-center gap-3">
                          <div className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">
                            {(pages.companies - 1) * PAGE_SIZE + idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-foreground text-xs truncate">{company}</span>
                              <span className="text-muted text-xs ml-2 flex-shrink-0">{count}</span>
                            </div>
                            <div className="h-1 bg-surface-alt rounded-full">
                              <div
                                className="h-1 bg-accent-blue rounded-full"
                                style={{ width: `${(count / (companiesData.items[0]?.[1] ?? 1)) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      total={companiesData.total}
                      page={companiesData.page}
                      pageSize={companiesData.pageSize}
                      onPage={(p) => setPage("companies", p)}
                    />
                  </>
                )}

                {/* Countries */}
                {tab === "countries" && countriesData && (
                  <>
                    <StatsList items={countriesData.items} max={countriesData.items[0]?.[1] ?? 1} />
                    <Pagination
                      total={countriesData.total}
                      page={countriesData.page}
                      pageSize={countriesData.pageSize}
                      onPage={(p) => setPage("countries", p)}
                    />
                  </>
                )}

                {/* Cities */}
                {tab === "cities" && citiesData && (
                  <>
                    <StatsList items={citiesData.items} max={citiesData.items[0]?.[1] ?? 1} />
                    <Pagination
                      total={citiesData.total}
                      page={citiesData.page}
                      pageSize={citiesData.pageSize}
                      onPage={(p) => setPage("cities", p)}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: persistent map ── */}
          <div className="flex-1 min-w-0">
            <div className="bg-surface border border-border rounded-xl overflow-hidden lg:sticky lg:top-[72px]">

              {/* Map header: mode toggle + hint */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                <div className="flex items-center gap-1">
                  {(["choropleth", "heatmap"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setMapMode(mode);
                        if (mode === "heatmap") setHeatmapEverOpened(true);
                      }}
                      className={`text-xs px-3 py-1 rounded transition-colors border ${
                        mapMode === mode
                          ? "border-accent-blue text-accent-blue bg-accent-blue/10"
                          : "border-border text-muted hover:text-foreground"
                      }`}
                    >
                      {mode === "choropleth" ? "By country" : "Global heatmap"}
                    </button>
                  ))}
                </div>
                {mapMode === "choropleth" && (
                  <span className="text-2xs text-muted-subtle hidden sm:block">
                    Click a country to filter
                  </span>
                )}
              </div>

              {/* Map itself */}
              <div className="relative w-full" style={{ height: "calc(100vh - 200px)", minHeight: "420px" }}>
                {mapMode === "choropleth" && (
                  mapCountriesData ? (
                    <CountryChoroplethDynamic
                      countryData={mapCountriesData.items}
                      onCountryClick={handleChoroplethCountryClick}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-subtle text-sm bg-surface-alt">
                      {mapCountriesLoading ? "Loading map…" : "No data"}
                    </div>
                  )
                )}
                {mapMode === "heatmap" && (
                  heatmapPoints.length > 0 ? (
                    <StargazerMapDynamic points={heatmapPoints} styleUrl={mapStyleUrl} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-subtle text-sm bg-surface-alt">
                      {globalMapLoading ? "Loading heatmap…" : "No data"}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}
