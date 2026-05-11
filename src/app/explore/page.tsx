// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Header } from "@/components/header";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { CommandSearch } from "@/components/command-search";
import { Footer } from "@/components/footer";
import { StatsList } from "@/components/stats-list";
import { FilterCombobox } from "@/components/filter-combobox";
import { CountryChoroplethDynamic } from "@/components/map/country-choropleth-dynamic";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { useFetch } from "@/hooks/use-fetch";
import { useTheme } from "@/hooks/useTheme";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import type { MapProjection } from "@/lib/theme";
import { gridToPoints } from "@/lib/grid-to-points";
import type { ExploreSummary } from "@/app/api/explore/route";
import type { TopUsersResponse, TopUser } from "@/app/api/explore/top/route";
import type { PowerResponse } from "@/app/api/explore/power/route";
import type { CompaniesResponse } from "@/app/api/explore/companies/route";
import type { LocationsResponse } from "@/app/api/explore/locations/route";
import type { GlobalMapData } from "@/app/api/explore/global-map/route";
import type { UserReposResponse } from "@/app/api/explore/user-repos/route";
import type { NearbyResponse } from "@/app/api/explore/nearby/route";
import type { GeocodeResponse } from "@/app/api/explore/geocode/route";
import type { StargazerPoint } from "@/app/api/chunk/route";

type Tab = "top" | "power" | "companies" | "countries" | "cities" | "nearby";

const PAGE_SIZE = 30;
const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";

type AutocompleteItem = {
  label: string;
  lat: number;
  lng: number;
};

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
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const url = open ? `/api/explore/user-repos?login=${encodeURIComponent(login)}` : null;
  const { data, loading } = useFetch<UserReposResponse>(url);

  useEffect(() => {
    if (data != null && data.totalRepos > resolvedCount) {
      setResolvedCount(data.totalRepos);
    }
  }, [data, resolvedCount]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const clickedBtn = btnRef.current?.contains(e.target as Node);
      const clickedPopover = popoverRef.current?.contains(e.target as Node);
      if (!clickedBtn && !clickedPopover) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="flex-shrink-0">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors tabular-nums ${
          open
            ? "border-accent-blue text-accent-blue bg-accent-blue/10"
            : "border-border-subtle text-muted hover:text-foreground hover:border-border"
        }`}
        title="View GitHub repos"
      >
        {resolvedCount} repos
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          style={{ top: popoverPos.top, right: popoverPos.right }}
          className="fixed w-72 bg-surface border border-border rounded-xl shadow-lg z-[9999] overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Top GitHub repos</span>
            <a
              href={`https://github.com/${login}?tab=repositories`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted hover:text-accent-blue transition-colors"
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
                          <span className="text-xs text-muted-subtle flex-shrink-0">{r.language}</span>
                        )}
                      </div>
                      {r.description && (
                        <div className="text-xs text-muted truncate mt-px">{r.description}</div>
                      )}
                    </div>
                    <span className="text-xs text-muted-subtle flex-shrink-0 tabular-nums mt-0.5">
                      ★ {(r.stars ?? 0).toLocaleString()}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

// ---------- User list skeleton ----------
const UserListSkeleton = () => (
  <div className="space-y-1" aria-busy="true" aria-label="Loading users">
    {Array.from({ length: 8 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg" aria-hidden="true">
        <div className="w-5 h-3 rounded bg-surface-alt animate-pulse flex-shrink-0" />
        <div className="w-8 h-8 rounded-full bg-surface-alt animate-pulse flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-3 rounded bg-surface-alt animate-pulse" style={{ width: `${55 + (i % 3) * 10}%` }} />
          <div className="h-2.5 rounded bg-surface-alt animate-pulse opacity-60" style={{ width: `${35 + (i % 4) * 8}%` }} />
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-14 h-4 rounded bg-surface-alt animate-pulse" />
          <div className="w-8 h-3 rounded bg-surface-alt animate-pulse" />
          <div className="w-9 h-6 rounded bg-surface-alt animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

// ---------- Location autocomplete input ----------
const LocationInput = ({
  value,
  onChange,
  onSelect,
  onSearch,
  onGeolocate,
  geoloading,
  searching,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (item: AutocompleteItem) => void;
  onSearch: () => void;
  onGeolocate: () => void;
  geoloading: boolean;
  searching: boolean;
  placeholder?: string;
}) => {
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch autocomplete suggestions via server-side proxy (token kept server-side)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/explore/autocomplete?q=${encodeURIComponent(value)}`);
        if (!res.ok) return;
        const items: AutocompleteItem[] = await res.json();
        setSuggestions(items);
        setOpen(items.length > 0);
        setActiveIndex(-1);
      } catch {
        // non-fatal
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (item: AutocompleteItem) => {
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter") { onSearch(); }
      if (e.key === "Escape") { setOpen(false); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIndex >= 0 ? suggestions[activeIndex] : suggestions[0];
      if (target) { handleSelect(target); }
      else { setOpen(false); onSearch(); }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Enter a city or place…"}
            className="w-full bg-background border border-border rounded-lg text-sm text-foreground
              placeholder:text-muted-subtle px-3 py-2 pr-8 focus:outline-none
              focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue transition-colors"
          />
          {value && (
            <button
              onClick={() => { onChange(""); setSuggestions([]); setOpen(false); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>

        {/* Search button */}
        <button
          onClick={() => { setOpen(false); onSearch(); }}
          disabled={!value.trim() || searching}
          className="flex-shrink-0 flex items-center justify-center h-9 px-3 rounded-lg border border-border
            text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium"
          title="Search"
        >
          {searching ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          )}
        </button>

        {/* Use my location button */}
        <button
          onClick={onGeolocate}
          disabled={geoloading}
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-border
            text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors disabled:opacity-50"
          title="Use my location"
        >
          {geoloading ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              <path d="M12 9a3 3 0 000 6" />
            </svg>
          )}
        </button>
      </div>

      {/* Autocomplete dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {suggestions.map((item, i) => (
            <button
              key={i}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full text-left px-3 py-2.5 text-sm text-foreground transition-colors
                first:rounded-t-xl last:rounded-b-xl border-b border-border-subtle last:border-0
                ${i === activeIndex ? "bg-accent-blue/10 text-accent-blue" : "hover:bg-surface-alt"}`}
            >
              <span className="text-muted-subtle mr-1.5 text-xs">📍</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- Main Page ----------

export default function ExplorePage() {
  const { theme } = useTheme();
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const VALID_TABS: Tab[] = ["top", "power", "companies", "countries", "cities", "nearby"];
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "top";
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    return t && VALID_TABS.includes(t) ? t : "top";
  });
  const [selectedCountry, setCountry] = useState(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("country") ?? "") : ""
  );
  const [searchInput, setSearchInput] = useState(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("q") ?? "") : ""
  );
  const [search, setSearch] = useState(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("q") ?? "") : ""
  );
  const [pages, setPages]                 = useState<Record<Tab, number>>({
    top: 1, power: 1, companies: 1, countries: 1, cities: 1, nearby: 1,
  });

  // Summary (loaded once)
  const [summary, setSummary]             = useState<ExploreSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Map panel state
  const [mapMode, setMapMode] = useState<"choropleth" | "heatmap">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("map") === "heatmap"
      ? "heatmap" : "choropleth"
  );
  const [mapEverOpened, setMapEverOpened] = useState(false);
  const [heatmapEverOpened, setHeatmapEverOpened] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("map") === "heatmap"
  );
  const mapColumnRef = useRef<HTMLDivElement>(null);

  // Nearby tab state
  const [tokenOpen, setTokenOpen]         = useState(false);
  const [hasToken, setHasToken]           = useState(false);

  // Map projection toggle
  const mapControlsRef = useRef<{
    toggleProjection: () => MapProjection;
    getProjection: () => MapProjection;
  } | null>(null);
  const [mapProjection, setMapProjection] = useState<MapProjection>("globe");

  const [nearbyInput, setNearbyInput]     = useState("");
  const [nearbyCoords, setNearbyCoords]   = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [nearbyRadius, setNearbyRadius]   = useState(50);
  const [nearbyGeoloading, setNearbyGeoloading] = useState(false);
  const [nearbySearching, setNearbySearching]   = useState(false);
  const [nearbyError, setNearbyError]     = useState<string | null>(null);
  const [nearbyFlyTarget, setNearbyFlyTarget] = useState<{ lat: number; lng: number; login: string; zoom?: number } | null>(null);
  const [userPin, setUserPin]                 = useState<TopUser | null>(null);

  useEffect(() => {
    setHasToken(!!getStoredToken());
  }, []);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    fetch("/api/explore")
      .then((r) => r.ok ? r.json() as Promise<ExploreSummary> : null)
      .then((d) => { if (d) setSummary(d); })
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, []);

  // On desktop (lg+) the map column is immediately visible — init right away.
  // On mobile it sits below the fold — use IntersectionObserver to defer until visible.
  useEffect(() => {
    const el = mapColumnRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setMapEverOpened(true); observer.disconnect(); } },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Debounce search input → search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.replace(/^@/, "")), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Sync active filters to URL so explore views are shareable
  useEffect(() => {
    const sp = new URLSearchParams();
    if (tab !== "top") sp.set("tab", tab);
    if (selectedCountry) sp.set("country", selectedCountry);
    if (search) sp.set("q", search);
    if (mapMode !== "choropleth") sp.set("map", mapMode);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `/explore?${qs}` : "/explore");
  }, [tab, selectedCountry, search, mapMode]);

  // Reset pages to 1 when filters change (except nearby — it manages its own page)
  const prevFilters = useRef({ selectedCountry, search });
  useEffect(() => {
    const prev = prevFilters.current;
    if (prev.selectedCountry !== selectedCountry || prev.search !== search) {
      prevFilters.current = { selectedCountry, search };
      setPages((p) => ({ ...p, top: 1, power: 1, companies: 1, countries: 1, cities: 1 }));
    }
  }, [selectedCountry, search]);

  // Reset nearby page when coords or radius change; re-fly map with radius-appropriate zoom
  useEffect(() => {
    setPages((p) => ({ ...p, nearby: 1 }));
    if (nearbyCoords) {
      // zoom ≈ 10 - log2(radius / 50): 25km→11, 50km→10, 100km→9, 200km→8
      const zoom = Math.round(10 - Math.log2(nearbyRadius / 50));
      setNearbyFlyTarget({ lat: nearbyCoords.lat, lng: nearbyCoords.lng, login: "__nearby_center__", zoom });
    }
  }, [nearbyCoords, nearbyRadius]);

  const setPage = (t: Tab, p: number) => setPages((prev) => ({ ...prev, [t]: p }));

  // Per-tab URLs
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

  const nearbyUrl = (tab === "nearby" && nearbyCoords)
    ? buildUrl("/api/explore/nearby", {
        lat: nearbyCoords.lat,
        lng: nearbyCoords.lng,
        radius: nearbyRadius,
        page: pages.nearby,
      })
    : null;

  // Map panel — always fetched on wide screens
  const mapCountriesUrl = mapEverOpened
    ? buildUrl("/api/explore/locations", { type: "country", size: 50 })
    : null;
  const globalMapUrl = heatmapEverOpened ? "/api/explore/global-map" : null;

  const { data: topData,          loading: topLoading }         = useFetch<TopUsersResponse>(topUrl);
  const { data: powerData,        loading: powerLoading }       = useFetch<PowerResponse>(powerUrl);
  const { data: companiesData,    loading: companiesLoading }   = useFetch<CompaniesResponse>(companiesUrl);
  const { data: countriesData,    loading: countriesLoading }   = useFetch<LocationsResponse>(countriesUrl);
  const { data: citiesData,       loading: citiesLoading }      = useFetch<LocationsResponse>(citiesUrl);
  const { data: nearbyData,       loading: nearbyLoading }      = useFetch<NearbyResponse>(nearbyUrl);
  const { data: mapCountriesData, loading: mapCountriesLoading } = useFetch<LocationsResponse>(mapCountriesUrl);
  const { data: globalMapData,    loading: globalMapLoading }   = useFetch<GlobalMapData>(globalMapUrl);

  const tabLoading = {
    top: topLoading, power: powerLoading, companies: companiesLoading,
    countries: countriesLoading, cities: citiesLoading, nearby: nearbyLoading,
  }[tab];

  // Grid cells → StargazerPoints (memoized)
  const heatmapPoints = useMemo(
    () => (globalMapData ? gridToPoints(globalMapData.cells) : []),
    [globalMapData],
  );

  // Nearby users → StargazerPoints (real profiles, lat/lng rounded to ~11km for privacy)
  const nearbyUserPoints = useMemo<StargazerPoint[]>(() => {
    if (!nearbyData?.users.length) return [];
    return nearbyData.users
      .filter((u) => u.lat !== 0 || u.lng !== 0)
      .map((u) => ({
        login: u.login,
        name: u.name,
        bio: null,
        company: u.company,
        location: [u.cityNormalized, u.countryNormalized].filter(Boolean).join(", ") || null,
        followers: u.followers,
        avatarUrl: `https://github.com/${u.login}.png`,
        lat: u.lat,
        lng: u.lng,
        starredAt: null,
        linkedinUrl: null,
      }));
  }, [nearbyData]);

  const showCountryFilter = tab !== "power" && tab !== "countries" && tab !== "nearby";
  const showSearch = tab === "top";

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    setSearchInput("");
    setSearch("");
    if (t === "nearby") setHeatmapEverOpened(true);
  }, []);

  const handleChoroplethCountryClick = useCallback((country: string) => {
    setCountry(country);
    setTab("top");
  }, []);

  // "Use my location" — browser geolocation + reverse geocode
  const handleGeolocate = useCallback(async () => {
    if (!navigator.geolocation) {
      setNearbyError("Geolocation is not supported by your browser.");
      return;
    }
    setNearbyGeoloading(true);
    setNearbyError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          const res = await fetch(`/api/explore/geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json() as GeocodeResponse;
            setNearbyInput(data.displayName);
            setNearbyCoords({ lat: data.lat, lng: data.lng, label: data.displayName });
          } else {
            setNearbyCoords({ lat, lng, label: `${lat.toFixed(2)}, ${lng.toFixed(2)}` });
            setNearbyInput(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          }
        } catch {
          setNearbyError("Could not determine your location name.");
        }
        setNearbyGeoloading(false);
      },
      () => {
        setNearbyError("Location access denied. Enter a city manually.");
        setNearbyGeoloading(false);
      },
      { timeout: 8000 },
    );
  }, []);

  const handleNearbySelect = useCallback((item: AutocompleteItem) => {
    setNearbyInput(item.label);
    setNearbyCoords({ lat: item.lat, lng: item.lng, label: item.label });
    setNearbyError(null);
  }, []);

  const handleNearbyInputChange = useCallback((v: string) => {
    setNearbyInput(v);
    setNearbyError(null);
    // Clear coords when user edits the input (forces re-selection)
    if (nearbyCoords && v !== nearbyCoords.label) {
      setNearbyCoords(null);
    }
  }, [nearbyCoords]);

  // Search by typing + Enter or clicking the search button — calls server-side geocode
  const handleNearbySearch = useCallback(async () => {
    const q = nearbyInput.trim();
    if (!q) return;
    setNearbySearching(true);
    setNearbyError(null);
    try {
      const res = await fetch(`/api/explore/geocode?q=${encodeURIComponent(q)}`);
      if (res.status === 404) {
        setNearbyError(`Location "${q}" not found. Try a different spelling.`);
        return;
      }
      if (!res.ok) {
        setNearbyError("Search failed. Please try again.");
        return;
      }
      const data = await res.json() as GeocodeResponse;
      setNearbyCoords({ lat: data.lat, lng: data.lng, label: data.displayName });
      setNearbyInput(data.displayName);
    } catch {
      setNearbyError("Search failed. Please try again.");
    } finally {
      setNearbySearching(false);
    }
  }, [nearbyInput]);

  const RADIUS_OPTIONS = [25, 50, 100, 200] as const;

  // Is the map showing nearby city data?
  const showNearbyMap = tab === "nearby" && nearbyUserPoints.length > 0;


  return (
    <div className="min-h-screen bg-background flex flex-col">
      <CommandSearch />
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        innerMaxWidth="max-w-7xl"
        projectionButton={
          <button
            onClick={() => {
              const next = mapControlsRef.current?.toggleProjection();
              if (next) setMapProjection(next);
            }}
            className="hidden md:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted hover:text-foreground hover:border-accent-blue transition-colors"
            title={mapProjection === "globe" ? "Switch to flat map" : "Switch to globe"}
          >
            {mapProjection === "globe" ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="6" width="18" height="12" rx="1" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="9" y1="6" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="18" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="3.5" ry="9" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            )}
            {mapProjection === "globe" ? "2D" : "3D"}
          </button>
        }
      />

      <main id="main" className="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-6 pt-6 pb-8">

        {/* Page title */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-foreground">Stargazer Intelligence</h1>
          <p className="text-muted text-sm mt-1">Global leaderboards across all tracked repos</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {([
            {
              label: "Developers",
              value: summaryLoading ? "…" : (summary?.totalUsers ?? 0).toLocaleString(),
              accent: "text-foreground",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-subtle">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              ),
            },
            {
              label: "Tracked repos",
              value: summaryLoading ? "…" : (summary?.totalTrackedRepos ?? 0).toLocaleString(),
              accent: "text-foreground",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted-subtle">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                </svg>
              ),
            },
            {
              label: "Star events",
              value: summaryLoading ? "…" : summary
                ? (summary.totalStarEvents >= 1000
                  ? `${(summary.totalStarEvents / 1000).toFixed(1)}k`
                  : summary.totalStarEvents.toString())
                : "…",
              accent: "text-accent-orange",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-accent-orange/60">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ),
            },
            {
              label: "Countries",
              value: summaryLoading ? "…" : (summary?.totalCountries ?? 0).toLocaleString(),
              accent: "text-accent-green",
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-accent-green/60">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ),
            },
          ] as const).map(({ label, value, accent, icon }) => (
            <div key={label} className="bg-surface border border-border rounded-xl px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                {icon}
                <span className="text-2xs text-muted uppercase tracking-wider font-medium">{label}</span>
              </div>
              <div className={`text-2xl font-bold tabular-nums leading-none ${accent}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">

          {/* ── LEFT COLUMN ── */}
          <div className="w-full lg:w-96 xl:w-[440px] flex-shrink-0">
            <div className="bg-surface border border-border rounded-xl overflow-hidden">

              {/* Tab bar */}
              <div className="relative">
                <div className="flex border-b border-border-subtle overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(["top", "power", "companies", "countries", "cities", "nearby"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTabChange(t)}
                      className={`flex-shrink-0 flex-1 py-3 text-xs font-medium transition-colors whitespace-nowrap px-2 ${
                        tab === t
                          ? "text-accent-blue border-b-2 border-accent-blue -mb-px bg-accent-blue/5"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {t === "top" ? "Top Stars"
                       : t === "power" ? (
                        <span className="inline-flex items-center justify-center gap-1">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                          </svg>
                          Power
                        </span>
                       ) : t === "companies" ? "Companies"
                       : t === "countries" ? "Countries"
                       : t === "cities" ? "Cities"
                       : (
                        <span className="inline-flex items-center justify-center gap-1">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                          Around Me
                        </span>
                       )}
                    </button>
                  ))}
                </div>
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent" aria-hidden="true" />
              </div>

              {/* Filter bar — hidden on "nearby" tab (has its own search) */}
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
                        placeholder:text-muted-subtle px-3 py-2 h-9 focus:outline-none
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
                {tabLoading && tab !== "nearby" && !{
                  top: topData, power: powerData, companies: companiesData,
                  countries: countriesData, cities: citiesData,
                }[tab as Exclude<Tab, "nearby">] && (
                  (tab === "top" || tab === "power") ? <UserListSkeleton /> : (
                    <div className="text-center text-muted-subtle text-sm py-12">Loading…</div>
                  )
                )}
                {/* Search in-flight loader (re-fetch with existing data) */}
                {tab === "top" && topLoading && topData && (
                  <div className="flex items-center gap-2 text-xs text-muted-subtle mb-3 px-2">
                    <svg className="animate-spin size-3 text-accent-blue flex-shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Searching…
                  </div>
                )}

                {/* Top Stars */}
                {tab === "top" && topData && (
                  <>
                    <div className="space-y-1">
                      {topData.items.map((u, i) => {
                        const isActive = userPin?.login === u.login;
                        const hasCoors = u.lat != null && u.lng != null;
                        return (
                        <div
                          key={u.login}
                          onClick={(e) => {
                            if ((e.target as Element).closest("button, a")) return;
                            window.location.href = `/profile/${u.login}`;
                          }}
                          className={`group flex items-center gap-3 px-2 py-2 min-h-11 rounded-lg transition-colors cursor-pointer
                            ${isActive ? "bg-accent-blue/8 ring-1 ring-accent-blue/20" : "hover:bg-surface-alt"}`}
                        >
                          <span className="text-muted-subtle text-xs w-5 text-right flex-shrink-0 tabular-nums">
                            {(pages.top - 1) * PAGE_SIZE + i + 1}
                          </span>
                          <img
                            src={u.avatarUrl}
                            alt={`Avatar of ${u.login}`}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <a
                                href={`/profile/${u.login}`}
                                className="text-accent-blue text-sm font-medium hover:underline truncate"
                              >
                                @{u.login}
                              </a>
                              {u.company && (
                                <span className="text-xs text-muted bg-surface-alt border border-border-subtle rounded px-1.5 py-px truncate max-w-24 flex-shrink-0 leading-5">
                                  {u.company.replace(/^@/, "")}
                                </span>
                              )}
                            </div>
                            {u.name && u.name !== u.login && (
                              <div className="text-muted-subtle text-xs truncate leading-tight">{u.name}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 justify-end">
                            <ReposBadge login={u.login} count={u.publicRepos} />
                            <span className="text-muted-subtle text-xs tabular-nums w-10 text-right">
                              {u.followers >= 1000
                                ? `${(u.followers / 1000).toFixed(1)}k`
                                : u.followers.toLocaleString()}
                            </span>
                            <button
                              onClick={() => {
                                if (!hasCoors) return;
                                setUserPin(isActive ? null : u);
                                setMapMode("heatmap");
                                setHeatmapEverOpened(true);
                                setMapEverOpened(true);
                                if (!isActive) {
                                  setNearbyFlyTarget({ lat: u.lat!, lng: u.lng!, login: u.login, zoom: 5 });
                                }
                              }}
                              title={!hasCoors ? "No location data" : isActive ? "Unpin from map" : "Show on map"}
                              aria-label={isActive ? "Unpin from map" : `Show ${u.login} on map`}
                              disabled={!hasCoors}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                                border transition-all duration-150
                                ${!hasCoors
                                  ? "invisible"
                                  : isActive
                                    ? "border-accent-blue text-accent-blue bg-accent-blue/10"
                                    : "border-border text-muted hover:text-accent-blue hover:border-accent-blue/60 hover:bg-accent-blue/5"
                                }`}
                            >
                              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M8 0C5.238 0 3 2.238 3 5c0 3.5 5 11 5 11s5-7.5 5-11c0-2.762-2.238-5-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/>
                              </svg>
                              {isActive ? "Pinned" : "Map"}
                            </button>
                          </div>
                        </div>
                        );
                      })}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-orange flex-shrink-0 mt-px" aria-hidden="true">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                      </svg>
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
                            <div className="flex justify-center mb-2">
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-subtle" aria-hidden="true">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                              </svg>
                            </div>
                            No power stargazers yet. Appears after multiple repos are scanned.
                          </div>
                        )}
                        <div className="space-y-1">
                          {powerData.items.map((u, i) => (
                            <div
                              key={u.login}
                              onClick={(e) => {
                                if ((e.target as Element).closest("button, a")) return;
                                window.location.href = `/profile/${u.login}`;
                              }}
                              className="group flex items-center gap-3 px-2 py-2 min-h-11 rounded-lg hover:bg-surface-alt transition-colors cursor-pointer"
                            >
                              <span className="text-muted-subtle text-xs w-5 text-right flex-shrink-0 tabular-nums">
                                {(pages.power - 1) * PAGE_SIZE + i + 1}
                              </span>
                              <img
                                src={u.avatarUrl}
                                alt={`Avatar of ${u.login}`}
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border"
                              />
                              <div className="flex-1 min-w-0">
                                <a
                                  href={`/profile/${u.login}`}
                                  className="text-accent-blue text-sm font-medium hover:underline"
                                >
                                  @{u.login}
                                </a>
                                {u.name && u.name !== u.login && (
                                  <div className="text-muted-subtle text-xs truncate leading-tight">{u.name}</div>
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

                {/* Around Me */}
                {tab === "nearby" && (
                  <div className="space-y-4">
                    {/* Search bar */}
                    <div className="space-y-2">
                      <LocationInput
                        value={nearbyInput}
                        onChange={handleNearbyInputChange}
                        onSelect={handleNearbySelect}
                        onSearch={handleNearbySearch}
                        onGeolocate={handleGeolocate}
                        geoloading={nearbyGeoloading}
                        searching={nearbySearching}
                        placeholder="City, region, or place…"
                      />

                      {/* Radius selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-subtle flex-shrink-0">Radius:</span>
                        {RADIUS_OPTIONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setNearbyRadius(r)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              nearbyRadius === r
                                ? "border-accent-blue text-accent-blue bg-accent-blue/10"
                                : "border-border-subtle text-muted hover:text-foreground hover:border-border"
                            }`}
                          >
                            {r}km
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Error */}
                    {nearbyError && (
                      <p className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-lg px-3 py-2">
                        {nearbyError}
                      </p>
                    )}

                    {/* Empty state — no search yet */}
                    {!nearbyCoords && !nearbyError && (
                      <div className="text-center py-10 space-y-2">
                        <div className="flex justify-center mb-1">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-subtle" aria-hidden="true">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                        </div>
                        <p className="text-sm text-muted">
                          Enter a location to discover GitHub developers nearby.
                        </p>
                        <p className="text-xs text-muted-subtle">
                          Based on public GitHub profiles. Locations may be approximate.
                        </p>
                      </div>
                    )}

                    {/* Loading */}
                    {nearbyLoading && !nearbyData && (
                      <div className="text-center text-muted-subtle text-sm py-8">Loading…</div>
                    )}

                    {/* Results */}
                    {nearbyCoords && nearbyData && (
                      <>
                        {/* Summary line */}
                        <div className="flex items-center justify-between text-xs text-muted-subtle pb-1 border-b border-border-subtle">
                          <span>
                            {nearbyData.total > 0
                              ? `${nearbyData.total.toLocaleString()} developer${nearbyData.total !== 1 ? "s" : ""} within ${nearbyRadius}km of ${nearbyCoords.label}`
                              : `No developers found within ${nearbyRadius}km`}
                          </span>
                        </div>

                        {/* City aggregates (mini) */}
                        {nearbyData.cities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {nearbyData.cities.slice(0, 8).map((c) => (
                              <span
                                key={c.city}
                                className="text-2xs px-2 py-0.5 rounded-full bg-surface-alt border border-border-subtle text-muted"
                              >
                                {c.city} <span className="text-foreground font-medium">{c.count}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* No results */}
                        {nearbyData.users.length === 0 && (
                          <div className="text-center py-8 space-y-1">
                            <div className="flex justify-center mb-1">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-subtle" aria-hidden="true">
                                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                              </svg>
                            </div>
                            <p className="text-sm text-muted">No developers found in this area.</p>
                            <p className="text-xs text-muted-subtle">Try a larger radius or a different location.</p>
                          </div>
                        )}

                        {/* User list */}
                        {nearbyData.users.length > 0 && (
                          <div className="space-y-1">
                            {nearbyData.users.map((u, i) => (
                              <div
                                key={u.login}
                                onClick={(e) => {
                                  if ((e.target as Element).closest("button, a")) return;
                                  window.location.href = `/profile/${u.login}`;
                                }}
                                className="group flex items-center gap-3 px-2 py-2 min-h-11 rounded-lg hover:bg-surface-alt transition-colors cursor-pointer"
                              >
                                <span className="text-muted-subtle text-xs w-5 text-right flex-shrink-0 tabular-nums">
                                  {(pages.nearby - 1) * PAGE_SIZE + i + 1}
                                </span>
                                <img
                                  src={`https://github.com/${u.login}.png`}
                                  alt={`Avatar of ${u.login}`}
                                  width={32}
                                  height={32}
                                  className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <a
                                      href={`/profile/${u.login}`}
                                      className="text-accent-blue text-sm font-medium hover:underline truncate"
                                    >
                                      @{u.login}
                                    </a>
                                    {u.company && (
                                      <span className="text-xs text-muted bg-surface-alt border border-border-subtle rounded px-1.5 py-px truncate max-w-24 flex-shrink-0 leading-5">
                                        {u.company.replace(/^@/, "")}
                                      </span>
                                    )}
                                  </div>
                                  {u.name && u.name !== u.login && (
                                    <div className="text-muted-subtle text-xs truncate leading-tight">{u.name}</div>
                                  )}
                                  {(u.cityNormalized || u.countryNormalized) && (
                                    <div className="text-muted-subtle text-xs truncate leading-tight">
                                      {[u.cityNormalized, u.countryNormalized].filter(Boolean).join(", ")}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0 justify-end">
                                  <ReposBadge login={u.login} count={u.trackedRepos} />
                                  <span className="text-muted-subtle text-xs tabular-nums w-10 text-right">
                                    {u.distanceKm} km
                                  </span>
                                  {(() => {
                                    const hasCoors = u.lat != null && u.lng != null;
                                    const isActive = userPin?.login === u.login;
                                    return (
                                      <button
                                        onClick={() => {
                                          if (!hasCoors) return;
                                          setUserPin(isActive ? null : {
                                            login: u.login,
                                            name: u.name ?? null,
                                            followers: 0,
                                            company: u.company ?? null,
                                            avatarUrl: `https://github.com/${u.login}.png`,
                                            publicRepos: u.trackedRepos ?? 0,
                                            lat: u.lat!,
                                            lng: u.lng!,
                                            countryNormalized: u.countryNormalized ?? null,
                                          });
                                          setMapMode("heatmap");
                                          setHeatmapEverOpened(true);
                                          setMapEverOpened(true);
                                          if (!isActive) {
                                            setNearbyFlyTarget({ lat: u.lat!, lng: u.lng!, login: u.login, zoom: 5 });
                                          }
                                        }}
                                        disabled={!hasCoors}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-all duration-150
                                          ${!hasCoors
                                            ? "invisible"
                                            : isActive
                                            ? "border-accent-blue text-accent-blue bg-accent-blue/10"
                                            : "border-border text-muted hover:text-accent-blue hover:border-accent-blue/60 hover:bg-accent-blue/5"
                                          }`}
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill={isActive ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
                                        </svg>
                                        {isActive ? "Pinned" : "Map"}
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {nearbyData.total > 0 && (
                          <Pagination
                            total={nearbyData.total}
                            page={nearbyData.page}
                            pageSize={nearbyData.pageSize}
                            onPage={(p) => setPage("nearby", p)}
                          />
                        )}

                        {/* Privacy disclaimer */}
                        <p className="text-2xs text-muted-subtle border-t border-border-subtle pt-3 mt-2">
                          Based on public GitHub profile locations, which may be approximate or outdated. Minimum
                          radius 25km for privacy.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: persistent map ── */}
          <div ref={mapColumnRef} className="flex-1 min-w-0">
            <div className="bg-surface border border-border rounded-xl overflow-hidden lg:sticky lg:top-[72px]">

              {/* Map header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                {showNearbyMap ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">Nearby developers</span>
                    <span className="text-2xs text-muted-subtle">
                      {nearbyData?.total ?? 0} developer{(nearbyData?.total ?? 0) !== 1 ? "s" : ""} on map
                    </span>
                  </div>
                ) : (
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
                )}
                {!showNearbyMap && mapMode === "choropleth" && (
                  selectedCountry ? (
                    <button
                      onClick={() => { setCountry(""); setTab("top"); }}
                      className="flex items-center gap-1.5 text-xs text-accent-blue bg-accent-blue/10 border border-accent-blue/30 rounded-md px-2.5 py-1 hover:bg-accent-blue/20 transition-colors"
                    >
                      {selectedCountry}
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
                    </button>
                  ) : (
                    <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted border border-border-subtle rounded-md px-2.5 py-1">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-accent-blue shrink-0">
                        <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l.47 2h1.72a.75.75 0 0 1 0 1.5H4.75a.75.75 0 0 1 0-1.5h1.72l.47-2H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                      </svg>
                      Click a country to filter
                    </span>
                  )
                )}
              </div>

              {/* Map */}
              <div className="relative w-full" style={{ height: "calc(100vh - 200px)", minHeight: "420px" }}>
                {showNearbyMap ? (
                  // Nearby tab with results — real user scatter
                  <>
                    <StargazerMapDynamic
                      points={nearbyUserPoints}
                      styleUrl={mapStyleUrl}
                      flyTarget={nearbyFlyTarget}
                      onFlyDone={() => setNearbyFlyTarget(null)}
                      onReady={(controls) => {
                        mapControlsRef.current = controls;
                        setMapProjection(controls.getProjection());
                      }}
                    />
                    {nearbyLoading && !nearbyData && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-surface/80 backdrop-blur-sm border border-border rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg">
                          <svg className="animate-spin size-4 text-accent-blue" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span className="text-sm text-muted">Loading…</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : tab === "nearby" ? (
                  // Nearby tab — no results yet, show choropleth as default
                  mapCountriesData ? (
                    <CountryChoroplethDynamic
                      countryData={mapCountriesData.items}
                      selectedCountry={selectedCountry}
                      onCountryClick={handleChoroplethCountryClick}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-subtle text-sm bg-surface-alt">
                      {mapCountriesLoading ? "Loading map…" : "No data"}
                    </div>
                  )
                ) : mapMode === "choropleth" ? (
                  mapCountriesData ? (
                    <CountryChoroplethDynamic
                      countryData={mapCountriesData.items}
                      selectedCountry={selectedCountry}
                      onCountryClick={handleChoroplethCountryClick}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-subtle text-sm bg-surface-alt">
                      {mapCountriesLoading ? "Loading map…" : "No data"}
                    </div>
                  )
                ) : (
                  heatmapPoints.length > 0 || userPin ? (
                    <StargazerMapDynamic
                      points={userPin
                        ? [{
                            login: userPin.login,
                            name: userPin.name,
                            bio: null,
                            company: userPin.company,
                            location: userPin.countryNormalized,
                            followers: userPin.followers,
                            avatarUrl: userPin.avatarUrl,
                            lat: userPin.lat!,
                            lng: userPin.lng!,
                            starredAt: null,
                            linkedinUrl: null,
                          }]
                        : heatmapPoints}
                      styleUrl={mapStyleUrl}
                      flyTarget={userPin ? nearbyFlyTarget : null}
                      onFlyDone={() => setNearbyFlyTarget(null)}
                      onReady={(controls) => {
                        mapControlsRef.current = controls;
                        setMapProjection(controls.getProjection());
                      }}
                    />
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
      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
